import {
  PrivacyBudgetManager,
  SensitivityAnalyzer,
  NoiseGenerator,
  BudgetExhaustionHandler,
  GroupByNoiseHandler,
  PrivacyModeManager
} from '../src/utils';
import {
  DPNoiseMechanism,
  PrivacyMode,
  BudgetExhaustedException,
  DifferentialPrivacyConfig
} from '@stellar/shared';

describe('Differential Privacy System', () => {
  let budgetManager: PrivacyBudgetManager;
  let sensitivityAnalyzer: SensitivityAnalyzer;
  let noiseGenerator: NoiseGenerator;
  let budgetHandler: BudgetExhaustionHandler;
  let groupByHandler: GroupByNoiseHandler;
  let modeManager: PrivacyModeManager;

  beforeAll(async () => {
    budgetManager = new PrivacyBudgetManager('redis://localhost:6379', {
      defaultEpsilon: 1.0,
      maxEpsilonPerQuery: 0.5,
      budgetResetInterval: 24,
      enableBudgetTracking: true
    });

    sensitivityAnalyzer = new SensitivityAnalyzer();
    noiseGenerator = new NoiseGenerator();
    budgetHandler = BudgetExhaustionHandler.getInstance();
    groupByHandler = new GroupByNoiseHandler();
    modeManager = PrivacyModeManager.getInstance();
  });

  afterAll(async () => {
    await budgetManager.disconnect();
  });

  describe('Privacy Budget Management', () => {
    const testUserId = 'test-user-123';
    const testDatasetId = 'test-dataset-456';

    beforeEach(async () => {
      await budgetManager.resetBudget(testUserId, testDatasetId);
    });

    test('should initialize budget for new user-dataset pair', async () => {
      const budget = await budgetManager.initializeBudget(testUserId, testDatasetId);
      
      expect(budget.userId).toBe(testUserId);
      expect(budget.datasetId).toBe(testDatasetId);
      expect(budget.totalEpsilon).toBe(1.0);
      expect(budget.remainingEpsilon).toBe(1.0);
      expect(budget.queriesCount).toBe(0);
    });

    test('should consume budget correctly', async () => {
      await budgetManager.initializeBudget(testUserId, testDatasetId);
      
      const updatedBudget = await budgetManager.consumeBudget(testUserId, testDatasetId, 0.3);
      
      expect(updatedBudget.remainingEpsilon).toBe(0.7);
      expect(updatedBudget.queriesCount).toBe(1);
    });

    test('should throw BudgetExhaustedException when insufficient budget', async () => {
      await budgetManager.initializeBudget(testUserId, testDatasetId);
      await budgetManager.consumeBudget(testUserId, testDatasetId, 0.8);
      
      await expect(
        budgetManager.consumeBudget(testUserId, testDatasetId, 0.3)
      ).rejects.toThrow(BudgetExhaustedException);
    });

    test('should check budget availability', async () => {
      await budgetManager.initializeBudget(testUserId, testDatasetId);
      
      const isAvailable = await budgetManager.checkBudgetAvailability(testUserId, testDatasetId, 0.5);
      expect(isAvailable).toBe(true);
      
      const isNotAvailable = await budgetManager.checkBudgetAvailability(testUserId, testDatasetId, 1.5);
      expect(isNotAvailable).toBe(false);
    });
  });

  describe('Sensitivity Analysis', () => {
    test('should analyze COUNT query sensitivity', () => {
      const query = 'SELECT COUNT(*) FROM users';
      const result = sensitivityAnalyzer.analyzeQuery(query, PrivacyMode.STRICT);
      
      expect(result.globalSensitivity).toBe(1);
      expect(result.aggregationType).toBe('count');
      expect(result.affectedColumns).toEqual(['*']);
    });

    test('should analyze SUM query sensitivity', () => {
      sensitivityAnalyzer.setColumnBounds('salary', 30000, 200000);
      
      const query = 'SELECT SUM(salary) FROM employees';
      const result = sensitivityAnalyzer.analyzeQuery(query, PrivacyMode.STRICT);
      
      expect(result.globalSensitivity).toBe(170000);
      expect(result.aggregationType).toBe('sum');
      expect(result.affectedColumns).toEqual(['salary']);
    });

    test('should analyze GROUP BY query sensitivity', () => {
      sensitivityAnalyzer.setColumnBounds('age', 18, 80);
      
      const query = 'SELECT AVG(age) FROM users GROUP BY department';
      const result = sensitivityAnalyzer.analyzeQuery(query, PrivacyMode.STRICT);
      
      expect(result.globalSensitivity).toBeGreaterThan(0);
      expect(result.groupBySensitivities.size).toBeGreaterThan(0);
    });

    test('should validate query for DP', () => {
      const validQuery = 'SELECT COUNT(*) FROM users';
      const invalidQuery = 'SELECT * FROM users';
      
      const validResult = sensitivityAnalyzer.validateQueryForDP(validQuery);
      expect(validResult.valid).toBe(true);
      
      const invalidResult = sensitivityAnalyzer.validateQueryForDP(invalidQuery);
      expect(invalidResult.valid).toBe(false);
    });
  });

  describe('Noise Generation', () => {
    test('should generate Laplace noise', () => {
      const epsilon = 0.1;
      const sensitivity = 1.0;
      
      const noise = noiseGenerator.generateLaplaceNoise(epsilon, sensitivity);
      
      expect(typeof noise).toBe('number');
      expect(noise).not.toBeNaN();
      expect(noise).toBeFinite();
    });

    test('should generate Gaussian noise', () => {
      const epsilon = 0.1;
      const delta = 1e-5;
      const sensitivity = 1.0;
      
      const noise = noiseGenerator.generateGaussianNoise(epsilon, delta, sensitivity);
      
      expect(typeof noise).toBe('number');
      expect(noise).not.toBeNaN();
      expect(noise).toBeFinite();
    });

    test('should add noise to value', () => {
      const value = 100;
      const parameters = {
        scale: 10,
        mechanism: DPNoiseMechanism.LAPLACE,
        sensitivity: 1.0,
        epsilon: 0.1
      };
      
      const result = noiseGenerator.addNoise(value, parameters);
      
      expect(result.originalValue).toBe(value);
      expect(result.noisyValue).not.toBe(value);
      expect(result.epsilonUsed).toBe(0.1);
      expect(result.mechanism).toBe(DPNoiseMechanism.LAPLACE);
    });

    test('should validate noise parameters', () => {
      const validParams = {
        scale: 10,
        mechanism: DPNoiseMechanism.LAPLACE,
        sensitivity: 1.0,
        epsilon: 0.1
      };
      
      const validation = noiseGenerator.validateNoiseParameters(validParams);
      expect(validation.valid).toBe(true);
      
      const invalidParams = { ...validParams, epsilon: -0.1 };
      const invalidValidation = noiseGenerator.validateNoiseParameters(invalidParams);
      expect(invalidValidation.valid).toBe(false);
    });
  });

  describe('Budget Exhaustion Handler', () => {
    test('should handle budget exhausted error', () => {
      const error = new BudgetExhaustedException('user1', 'dataset1', 0.5, 0.1);
      const handling = budgetHandler.handleBudgetExhausted(error);
      
      expect(handling.shouldRetry).toBe(false);
      expect(handling.message).toContain('completely exhausted');
    });

    test('should provide alternative epsilon for partial exhaustion', () => {
      const error = new BudgetExhaustedException('user1', 'dataset1', 0.5, 0.3);
      const handling = budgetHandler.handleBudgetExhausted(error);
      
      expect(handling.shouldRetry).toBe(true);
      expect(handling.alternativeEpsilon).toBeGreaterThan(0);
      expect(handling.alternativeEpsilon).toBeLessThan(0.5);
    });

    test('should create budget exhausted response', () => {
      const error = new BudgetExhaustedException('user1', 'dataset1', 0.5, 0.1);
      const response = budgetHandler.createBudgetExhaustedResponse(error);
      
      expect(response.error.name).toBe('BudgetExhaustedException');
      expect(response.error.userId).toBe('user1');
      expect(response.error.datasetId).toBe('dataset1');
      expect(response.handling.shouldRetry).toBe(false);
    });
  });

  describe('Group-By Noise Handler', () => {
    test('should apply noise to group-by results', async () => {
      const query = {
        groupColumns: ['department'],
        aggregations: [{ type: 'count', column: '*' }],
        data: [
          { groupKey: 'engineering', values: { '*': 10 }, count: 10 },
          { groupKey: 'marketing', values: { '*': 5 }, count: 5 }
        ]
      };
      
      const results = await groupByHandler.applyGroupByNoise(
        query,
        0.2,
        DPNoiseMechanism.LAPLACE,
        PrivacyMode.STRICT
      );
      
      expect(results).toHaveLength(2);
      expect(results[0].groupKey).toBe('engineering');
      expect(results[0].results).toHaveLength(1);
      expect(results[0].totalEpsilonUsed).toBeGreaterThan(0);
    });

    test('should validate group-by query', () => {
      const validQuery = {
        groupColumns: ['department'],
        aggregations: [{ type: 'count', column: '*' }],
        data: [{ groupKey: 'eng', values: {}, count: 5 }]
      };
      
      const validation = groupByHandler.validateGroupByQuery(validQuery);
      expect(validation.valid).toBe(true);
      
      const invalidQuery = { ...validQuery, groupColumns: [] };
      const invalidValidation = groupByHandler.validateGroupByQuery(invalidQuery);
      expect(invalidValidation.valid).toBe(false);
    });

    test('should estimate noise magnitude', () => {
      const query = {
        groupColumns: ['dept'],
        aggregations: [{ type: 'count', column: '*' }],
        data: [{ groupKey: 'eng', values: {}, count: 10 }]
      };
      
      const estimate = groupByHandler.estimateGroupByNoise(
        query,
        0.1,
        DPNoiseMechanism.LAPLACE,
        PrivacyMode.STRICT
      );
      
      expect(estimate.averageNoise).toBeGreaterThan(0);
      expect(estimate.maxNoise).toBeGreaterThanOrEqual(estimate.averageNoise);
      expect(estimate.totalEpsilonUsed).toBe(0.1);
    });
  });

  describe('Privacy Mode Manager', () => {
    test('should toggle between modes', () => {
      const initialMode = modeManager.getPrivacyMode();
      const newMode = modeManager.toggleMode();
      
      expect(newMode).not.toBe(initialMode);
      expect(modeManager.getPrivacyMode()).toBe(newMode);
    });

    test('should adapt config for mode', () => {
      const baseConfig: DifferentialPrivacyConfig = {
        epsilon: 1.0,
        mechanism: DPNoiseMechanism.LAPLACE,
        mode: PrivacyMode.STRICT,
        enableGroupByNoise: true
      };
      
      modeManager.setPrivacyMode(PrivacyMode.RELAXED);
      const adaptedConfig = modeManager.adaptConfigForMode(baseConfig);
      
      expect(adaptedConfig.epsilon).toBeLessThan(baseConfig.epsilon);
      expect(adaptedConfig.mode).toBe(PrivacyMode.RELAXED);
    });

    test('should validate mode transition', () => {
      modeManager.setPrivacyMode(PrivacyMode.STRICT);
      
      const validation = modeManager.validateModeTransition(PrivacyMode.RELAXED);
      expect(validation.valid).toBe(true);
      expect(validation.warnings.length).toBeGreaterThan(0);
    });

    test('should provide privacy report', () => {
      modeManager.setPrivacyMode(PrivacyMode.STRICT);
      const report = modeManager.getPrivacyReport();
      
      expect(report.currentMode).toBe(PrivacyMode.STRICT);
      expect(report.modeConfig).toBeDefined();
      expect(report.recommendations).toBeDefined();
      expect(report.riskLevel).toBe('LOW');
    });

    test('should suppress results based on mode', () => {
      modeManager.setPrivacyMode(PrivacyMode.STRICT);
      
      const shouldSuppress = modeManager.shouldSuppressResult(2, 150);
      expect(shouldSuppress).toBe(true);
      
      modeManager.setPrivacyMode(PrivacyMode.RELAXED);
      const shouldNotSuppress = modeManager.shouldSuppressResult(5, 50);
      expect(shouldNotSuppress).toBe(false);
    });
  });

  describe('Integration Tests', () => {
    test('should handle complete DP workflow', async () => {
      const userId = 'integration-user';
      const datasetId = 'integration-dataset';
      
      await budgetManager.initializeBudget(userId, datasetId);
      
      const query = 'SELECT COUNT(*) FROM users';
      const sensitivity = sensitivityAnalyzer.analyzeQuery(query, PrivacyMode.STRICT);
      
      const originalValue = 100;
      const noiseParams = {
        scale: sensitivity.globalSensitivity / 0.1,
        mechanism: DPNoiseMechanism.LAPLACE,
        sensitivity: sensitivity.globalSensitivity,
        epsilon: 0.1
      };
      
      const dpResult = noiseGenerator.addNoise(originalValue, noiseParams);
      
      const updatedBudget = await budgetManager.consumeBudget(userId, datasetId, 0.1);
      
      expect(dpResult.originalValue).toBe(originalValue);
      expect(dpResult.noisyValue).not.toBe(originalValue);
      expect(updatedBudget.remainingEpsilon).toBe(0.9);
      expect(updatedBudget.queriesCount).toBe(1);
    });

    test('should handle budget exhaustion in workflow', async () => {
      const userId = 'exhaustion-user';
      const datasetId = 'exhaustion-dataset';
      
      await budgetManager.initializeBudget(userId, datasetId);
      await budgetManager.consumeBudget(userId, datasetId, 0.9);
      
      try {
        await budgetManager.consumeBudget(userId, datasetId, 0.2);
        fail('Should have thrown BudgetExhaustedException');
      } catch (error) {
        expect(error).toBeInstanceOf(BudgetExhaustedException);
        
        const handling = budgetHandler.handleBudgetExhausted(error as BudgetExhaustedException);
        expect(handling.alternativeEpsilon).toBeGreaterThan(0);
      }
    });
  });
});
