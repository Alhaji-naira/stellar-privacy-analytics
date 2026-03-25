import { Request, Response, NextFunction } from 'express';
import {
  DifferentialPrivacyConfig,
  PrivacyMode,
  DPNoiseMechanism,
  DifferentialPrivacyResult,
  GroupByResult,
  BudgetExhaustedException,
  QueryInfo
} from '@stellar/shared';
import { PrivacyBudgetManager } from '../utils/privacyBudget';
import { SensitivityAnalyzer } from '../utils/sensitivityAnalyzer';
import { NoiseGenerator } from '../utils/noiseGenerator';
import { BudgetExhaustionHandler } from '../utils/budgetExhaustionHandler';
import { GroupByNoiseHandler } from '../utils/groupByNoiseHandler';
import { PrivacyModeManager } from '../utils/privacyModeManager';

export interface DifferentialPrivacyRequest extends Request {
  dpConfig?: DifferentialPrivacyConfig;
  userId?: string;
  datasetId?: string;
  query?: string;
}

export interface QueryResult {
  data: any;
  metadata?: {
    rowCount?: number;
    executionTime?: number;
    [key: string]: any;
  };
}

export class DifferentialPrivacyMiddleware {
  private budgetManager: PrivacyBudgetManager;
  private sensitivityAnalyzer: SensitivityAnalyzer;
  private noiseGenerator: NoiseGenerator;
  private budgetHandler: BudgetExhaustionHandler;
  private groupByHandler: GroupByNoiseHandler;
  private modeManager: PrivacyModeManager;

  constructor(redisUrl: string) {
    this.budgetManager = new PrivacyBudgetManager(redisUrl, {
      defaultEpsilon: 1.0,
      maxEpsilonPerQuery: 0.5,
      budgetResetInterval: 24,
      enableBudgetTracking: true
    });
    
    this.sensitivityAnalyzer = new SensitivityAnalyzer();
    this.noiseGenerator = new NoiseGenerator();
    this.budgetHandler = BudgetExhaustionHandler.getInstance();
    this.groupByHandler = new GroupByNoiseHandler();
    this.modeManager = PrivacyModeManager.getInstance();
  }

  middleware() {
    return async (req: DifferentialPrivacyRequest, res: Response, next: NextFunction) => {
      try {
        if (!this.shouldApplyDifferentialPrivacy(req)) {
          return next();
        }

        const dpConfig = this.extractDPConfig(req);
        req.dpConfig = dpConfig;

        const userId = req.userId || this.extractUserId(req);
        const datasetId = req.datasetId || this.extractDatasetId(req);
        
        if (!userId || !datasetId) {
          return res.status(400).json({
            error: 'Missing userId or datasetId for differential privacy'
          });
        }

        req.userId = userId;
        req.datasetId = datasetId;

        const originalSend = res.send;
        res.send = async (data: any) => {
          try {
            const processedData = await this.processResponse(data, req, res);
            return originalSend.call(res, processedData);
          } catch (error) {
            console.error('Differential privacy processing error:', error);
            return originalSend.call(res, data);
          }
        };

        next();
      } catch (error) {
        console.error('Differential privacy middleware error:', error);
        next(error);
      }
    };
  }

  private shouldApplyDifferentialPrivacy(req: Request): boolean {
    const dpHeader = req.headers['x-differential-privacy'];
    const privacyHeader = req.headers['x-privacy-level'];
    
    return dpHeader === 'true' || 
           privacyHeader === 'differential' ||
           req.path.includes('/analytics') ||
           req.path.includes('/query');
  }

  private extractDPConfig(req: Request): DifferentialPrivacyConfig {
    const header = req.headers['x-dp-config'];
    let config: DifferentialPrivacyConfig;

    if (header && typeof header === 'string') {
      try {
        config = JSON.parse(header);
      } catch {
        config = this.getDefaultConfig();
      }
    } else {
      config = this.getDefaultConfig();
    }

    return this.modeManager.adaptConfigForMode(config);
  }

  private getDefaultConfig(): DifferentialPrivacyConfig {
    return {
      epsilon: 0.1,
      mechanism: DPNoiseMechanism.LAPLACE,
      mode: PrivacyMode.STRICT,
      enableGroupByNoise: true
    };
  }

  private extractUserId(req: Request): string | undefined {
    return req.headers['x-user-id'] as string || 
           (req as any).userId ||
           'anonymous';
  }

  private extractDatasetId(req: Request): string | undefined {
    return req.headers['x-dataset-id'] as string ||
           req.query.dataset as string ||
           'default';
  }

  private async processResponse(
    data: any,
    req: DifferentialPrivacyRequest,
    res: Response
  ): Promise<any> {
    if (!req.dpConfig || !req.userId || !req.datasetId) {
      return data;
    }

    try {
      if (this.isQueryResult(data)) {
        return await this.processQueryResult(data, req);
      } else if (this.isGroupByResult(data)) {
        return await this.processGroupByResult(data, req);
      } else if (this.isAggregatedData(data)) {
        return await this.processAggregatedData(data, req);
      }

      return data;
    } catch (error) {
      if (error instanceof BudgetExhaustedException) {
        const handling = this.budgetHandler.handleBudgetExhausted(error);
        return res.status(429).json({
          error: 'Privacy budget exhausted',
          handling,
          timestamp: new Date().toISOString()
        });
      }
      throw error;
    }
  }

  private async processQueryResult(
    result: QueryResult,
    req: DifferentialPrivacyRequest
  ): Promise<QueryResult> {
    if (!req.query) {
      return result;
    }

    const sensitivity = this.sensitivityAnalyzer.analyzeQuery(
      req.query,
      req.dpConfig!.mode
    );

    await this.budgetManager.consumeBudget(
      req.userId!,
      req.datasetId!,
      req.dpConfig!.epsilon
    );

    const processedData = await this.applyNoiseToData(
      result.data,
      sensitivity,
      req.dpConfig!
    );

    return {
      ...result,
      data: processedData,
      metadata: {
        ...result.metadata,
        differentialPrivacy: {
          epsilon: req.dpConfig!.epsilon,
          mechanism: req.dpConfig!.mechanism,
          sensitivity: sensitivity.globalSensitivity,
          mode: req.dpConfig!.mode
        }
      }
    };
  }

  private async processGroupByResult(
    data: any[],
    req: DifferentialPrivacyRequest
  ): Promise<GroupByResult[]> {
    if (!req.dpConfig!.enableGroupByNoise) {
      return data;
    }

    const groupByQuery = this.parseGroupByData(data);
    const results = await this.groupByHandler.applyGroupByNoise(
      groupByQuery,
      req.dpConfig!.epsilon,
      req.dpConfig!.mechanism,
      req.dpConfig!.mode
    );

    await this.budgetManager.consumeBudget(
      req.userId!,
      req.datasetId!,
      req.dpConfig!.epsilon
    );

    return results;
  }

  private async processAggregatedData(
    data: any,
    req: DifferentialPrivacyRequest
  ): Promise<any> {
    if (typeof data !== 'object' || data === null) {
      return data;
    }

    const processed: any = {};
    
    for (const [key, value] of Object.entries(data)) {
      if (typeof value === 'number') {
        const sensitivity = 1.0;
        const noiseParams = {
          scale: sensitivity / req.dpConfig!.epsilon,
          mechanism: req.dpConfig!.mechanism,
          sensitivity,
          epsilon: req.dpConfig!.epsilon
        };

        const result = this.noiseGenerator.addNoise(value, noiseParams);
        processed[key] = result.noisyValue;
      } else {
        processed[key] = value;
      }
    }

    await this.budgetManager.consumeBudget(
      req.userId!,
      req.datasetId!,
      req.dpConfig!.epsilon
    );

    return processed;
  }

  private async applyNoiseToData(
    data: any,
    sensitivity: any,
    config: DifferentialPrivacyConfig
  ): Promise<any> {
    if (Array.isArray(data)) {
      return Promise.all(data.map(item => this.applyNoiseToData(item, sensitivity, config)));
    }

    if (typeof data === 'object' && data !== null) {
      const processed: any = {};
      
      for (const [key, value] of Object.entries(data)) {
        if (typeof value === 'number') {
          const noiseParams = {
            scale: sensitivity.globalSensitivity / config.epsilon,
            mechanism: config.mechanism,
            sensitivity: sensitivity.globalSensitivity,
            epsilon: config.epsilon
          };

          const result = this.noiseGenerator.addNoise(value, noiseParams);
          processed[key] = result.noisyValue;
        } else {
          processed[key] = value;
        }
      }
      
      return processed;
    }

    return data;
  }

  private isQueryResult(data: any): data is QueryResult {
    return typeof data === 'object' && 
           data !== null && 
           'data' in data;
  }

  private isGroupByResult(data: any): boolean {
    return Array.isArray(data) && 
           data.length > 0 && 
           typeof data[0] === 'object' &&
           'groupKey' in data[0];
  }

  private isAggregatedData(data: any): boolean {
    return typeof data === 'object' && 
           data !== null && 
           !('data' in data) &&
           !Array.isArray(data) &&
           Object.values(data).some(value => typeof value === 'number');
  }

  private parseGroupByData(data: any[]): any {
    return {
      groupColumns: ['groupKey'],
      aggregations: [
        { type: 'COUNT', column: 'count' },
        { type: 'SUM', column: 'value' }
      ],
      data: data.map(item => ({
        groupKey: item.groupKey,
        values: { value: item.value || 0 },
        count: item.count || 1
      }))
    };
  }

  async getPrivacyBudget(userId: string, datasetId: string) {
    return this.budgetManager.getBudget(userId, datasetId);
  }

  async resetPrivacyBudget(userId: string, datasetId: string) {
    return this.budgetManager.resetBudget(userId, datasetId);
  }

  setPrivacyMode(mode: PrivacyMode) {
    this.modeManager.setPrivacyMode(mode);
  }

  getPrivacyMode(): PrivacyMode {
    return this.modeManager.getPrivacyMode();
  }

  getPrivacyReport() {
    return this.modeManager.getPrivacyReport();
  }

  async shutdown() {
    await this.budgetManager.disconnect();
  }
}
