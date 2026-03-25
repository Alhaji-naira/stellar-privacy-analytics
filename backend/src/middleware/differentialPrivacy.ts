import { Request, Response, NextFunction } from 'express';
import {
  DifferentialPrivacy,
  PrivacyBudgetManager,
  SensitivityAnalyzer,
  DifferentialPrivacyConfig,
  BudgetExhaustedException,
  InvalidQueryException,
  PrivacyMode,
  NoiseDistribution
} from '../utils';
import { logger } from '../utils/logger';

export interface DifferentialPrivacyRequest extends Request {
  privacyContext?: {
    dataset: string;
    sensitivity: number;
    epsilonUsed: number;
    queryType: string;
  };
}

export class DifferentialPrivacyMiddleware {
  private dp: DifferentialPrivacy;
  private sensitivityAnalyzer: SensitivityAnalyzer;
  private config: DifferentialPrivacyConfig;

  constructor(config: DifferentialPrivacyConfig) {
    this.config = config;
    this.dp = new DifferentialPrivacy(config);
    this.sensitivityAnalyzer = new SensitivityAnalyzer();
  }

  private async getBudgetManager(): Promise<PrivacyBudgetManager> {
    return await PrivacyBudgetManager.getInstance();
  }

  public middleware() {
    return async (req: DifferentialPrivacyRequest, res: Response, next: NextFunction) => {
      try {
        if (!this.shouldApplyDifferentialPrivacy(req)) {
          return next();
        }

        const dataset = this.extractDataset(req);
        if (!dataset) {
          return res.status(400).json({
            error: 'Dataset identifier required for differential privacy',
            code: 'DATASET_REQUIRED'
          });
        }

        const query = this.extractQuery(req);
        if (!query) {
          return res.status(400).json({
            error: 'Query required for differential privacy',
            code: 'QUERY_REQUIRED'
          });
        }

        const sensitivity = this.sensitivityAnalyzer.analyzeQuery(query);
        const epsilonCost = this.sensitivityAnalyzer.calculateEpsilonCost(
          sensitivity,
          sensitivity.groupBy ? sensitivity.groupBy.length : 1
        );

        const budgetManager = await this.getBudgetManager();
        const canAfford = await budgetManager.checkBudget(dataset, epsilonCost);
        if (!canAfford) {
          const budget = await budgetManager.getBudget(dataset);
          return res.status(429).json({
            error: 'Privacy budget exhausted',
            code: 'BUDGET_EXHAUSTED',
            dataset,
            remainingBudget: budget?.remaining || 0,
            required: epsilonCost
          });
        }

        req.privacyContext = {
          dataset,
          sensitivity: sensitivity.sensitivity,
          epsilonUsed: epsilonCost,
          queryType: sensitivity.type
        };

        next();
      } catch (error) {
        logger.error('Differential privacy middleware error:', error);

        if (error instanceof InvalidQueryException) {
          return res.status(400).json({
            error: 'Invalid query',
            code: 'INVALID_QUERY',
            query: error.query,
            details: error.message
          });
        }

        if (error instanceof BudgetExhaustedException) {
          return res.status(429).json({
            error: 'Privacy budget exhausted',
            code: 'BUDGET_EXHAUSTED',
            dataset: error.dataset,
            remainingBudget: error.remainingBudget
          });
        }

        return res.status(500).json({
          error: 'Internal server error',
          code: 'INTERNAL_ERROR'
        });
      }
    };
  }

  public responseProcessor() {
    return async (req: DifferentialPrivacyRequest, res: Response, next: NextFunction) => {
      if (!req.privacyContext) {
        return next();
      }

      const originalJson = res.json;
      res.json = function (data: any) {
        if (req.privacyContext && typeof data === 'object') {
          try {
            const processedData = req.dp.processResponse(data, req.privacyContext);
            return originalJson.call(this, processedData);
          } catch (error) {
            logger.error('Error processing response with differential privacy:', error);
            return originalJson.call(this, data);
          }
        }
        return originalJson.call(this, data);
      };

      next();
    };
  }

  private shouldApplyDifferentialPrivacy(req: Request): boolean {
    const privacyHeader = req.headers['x-privacy-level'];
    const privacyQuery = req.query.privacy;

    return privacyHeader === 'differential' ||
      privacyQuery === 'differential' ||
      req.path.includes('/analytics') ||
      req.path.includes('/data/query');
  }

  private extractDataset(req: Request): string | null {
    return req.headers['x-dataset'] as string ||
      req.body?.dataset ||
      req.query?.dataset as string ||
      null;
  }

  private extractQuery(req: Request): string | null {
    return req.body?.query ||
      req.query?.query as string ||
      null;
  }

  public async initializeDataset(dataset: string, epsilon: number, delta: number = 1e-10): Promise<void> {
    const budgetManager = await this.getBudgetManager();
    await budgetManager.initializeBudget(dataset, epsilon, delta);
  }

  public updateConfig(newConfig: Partial<DifferentialPrivacyConfig>): void {
    this.config = { ...this.config, ...newConfig };
    this.dp.updateConfig(newConfig);
  }

  public getConfig(): DifferentialPrivacyConfig {
    return { ...this.config };
  }

  public async getBudgetStatus(dataset: string): Promise<any> {
    const budgetManager = await this.getBudgetManager();
    const budget = await budgetManager.getBudget(dataset);
    if (!budget) {
      return null;
    }

    const usage = await budgetManager.getBudgetUsage(dataset);

    return {
      dataset: budget.dataset,
      totalEpsilon: budget.epsilon,
      remaining: budget.remaining,
      usage: `${usage.toFixed(2)}%`,
      lastUpdated: budget.lastUpdated,
      exhausted: budget.remaining <= 0
    };
  }
}

DifferentialPrivacy.prototype.processResponse = function (data: any, context: any): any {
  if (Array.isArray(data)) {
    return data.map(item => this.processDataItem(item, context));
  }

  return this.processDataItem(data, context);
};

DifferentialPrivacy.prototype.processDataItem = function (item: any, context: any): any {
  if (typeof item !== 'object' || item === null) {
    if (typeof item === 'number') {
      return this.addNoise(item, context.sensitivity, context.epsilonUsed);
    }
    return item;
  }

  const processed = { ...item };

  for (const [key, value] of Object.entries(processed)) {
    if (typeof value === 'number' && !isNaN(value)) {
      processed[key] = this.addNoise(value, context.sensitivity, context.epsilonUsed);
    } else if (Array.isArray(value)) {
      processed[key] = value.map(v =>
        typeof v === 'number' ? this.addNoise(v, context.sensitivity, context.epsilonUsed) : v
      );
    }
  }

  return processed;
};
