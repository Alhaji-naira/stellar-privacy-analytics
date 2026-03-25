import { DifferentialPrivacy, PrivacyBudgetManager, SensitivityAnalyzer } from '../utils';
import { NoiseDistribution, PrivacyMode, DifferentialPrivacyConfig } from '../utils/differentialPrivacy/types';

describe('Differential Privacy Core', () => {
  let dp: DifferentialPrivacy;
  let config: DifferentialPrivacyConfig;

  beforeEach(() => {
    config = {
      epsilon: 1.0,
      delta: 1e-10,
      distribution: NoiseDistribution.LAPLACE,
      mode: PrivacyMode.STRICT,
      enableGroupByNoise: true
    };
    dp = new DifferentialPrivacy(config);
  });

  describe('Noise Generation', () => {
    it('should add Laplace noise to a value', () => {
      const value = 100;
      const sensitivity = 1;
      const result = dp.addNoise(value, sensitivity);
      
      expect(typeof result).toBe('number');
      expect(result).not.toBe(value);
      expect(result).toBeGreaterThanOrEqual(0);
    });

    it('should add Gaussian noise to a value', () => {
      dp.updateConfig({ distribution: NoiseDistribution.GAUSSIAN });
      const value = 100;
      const sensitivity = 1;
      const result = dp.addNoise(value, sensitivity);
      
      expect(typeof result).toBe('number');
      expect(result).not.toBe(value);
    });

    it('should throw error when epsilon is exhausted', () => {
      const value = 100;
      const sensitivity = 1;
      
      expect(() => dp.addNoise(value, sensitivity, 0)).toThrow('Epsilon budget exhausted');
    });
  });

  describe('Group-By Operations', () => {
    it('should apply noise to group-by aggregations', () => {
      const groups = new Map<string, number[]>();
      groups.set('A', [10, 20, 30]);
      groups.set('B', [15, 25, 35]);
      
      const sensitivity = 1;
      const result = dp.addNoiseToGroupBy(groups, sensitivity);
      
      expect(result.size).toBe(2);
      expect(result.has('A')).toBe(true);
      expect(result.has('B')).toBe(true);
      
      const noisyA = result.get('A')!;
      const noisyB = result.get('B')!;
      
      expect(noisyA.length).toBe(3);
      expect(noisyB.length).toBe(3);
      
      noisyA.forEach((val, i) => {
        expect(val).not.toBe(groups.get('A')![i]);
      });
    });

    it('should skip group-by noise when disabled', () => {
      dp.updateConfig({ enableGroupByNoise: false });
      
      const groups = new Map<string, number[]>();
      groups.set('A', [10, 20, 30]);
      
      const sensitivity = 1;
      const result = dp.addNoiseToGroupBy(groups, sensitivity);
      
      expect(result).toBe(groups);
    });
  });

  describe('Privacy Modes', () => {
    it('should enforce non-negative results in strict mode', () => {
      const value = 1;
      const sensitivity = 10;
      const result = dp.addNoise(value, sensitivity);
      
      expect(result).toBeGreaterThanOrEqual(0);
    });

    it('should allow negative results in relaxed mode', () => {
      dp.updateConfig({ mode: PrivacyMode.RELAXED });
      
      const value = 1;
      const sensitivity = 10;
      const result = dp.addNoise(value, sensitivity);
      
      expect(typeof result).toBe('number');
    });
  });
});

describe('Sensitivity Analyzer', () => {
  let analyzer: SensitivityAnalyzer;

  beforeEach(() => {
    analyzer = new SensitivityAnalyzer();
  });

  describe('Query Parsing', () => {
    it('should parse COUNT queries', () => {
      const query = 'SELECT COUNT(*) FROM users';
      const sensitivity = analyzer.analyzeQuery(query);
      
      expect(sensitivity.type).toBe('count');
      expect(sensitivity.sensitivity).toBe(1);
    });

    it('should parse SUM queries', () => {
      const query = 'SELECT SUM(amount) FROM transactions';
      const sensitivity = analyzer.analyzeQuery(query, 1000);
      
      expect(sensitivity.type).toBe('sum');
      expect(sensitivity.sensitivity).toBe(1000);
    });

    it('should parse AVERAGE queries', () => {
      const query = 'SELECT AVG(score) FROM grades';
      const sensitivity = analyzer.analyzeQuery(query, 100);
      
      expect(sensitivity.type).toBe('average');
      expect(sensitivity.sensitivity).toBe(50);
    });

    it('should parse GROUP BY queries', () => {
      const query = 'SELECT COUNT(*) FROM users GROUP BY department';
      const sensitivity = analyzer.analyzeQuery(query);
      
      expect(sensitivity.type).toBe('count');
      expect(sensitivity.groupBy).toEqual(['department']);
    });

    it('should throw error for invalid queries', () => {
      const query = 'INVALID SQL QUERY';
      
      expect(() => analyzer.analyzeQuery(query)).toThrow('Unable to parse query');
    });
  });

  describe('Epsilon Cost Calculation', () => {
    it('should calculate epsilon cost for simple queries', () => {
      const sensitivity = {
        sensitivity: 1,
        type: 'count' as const
      };
      
      const cost = analyzer.calculateEpsilonCost(sensitivity, 1, 1.0);
      expect(cost).toBe(1.0);
    });

    it('should calculate epsilon cost for group-by queries', () => {
      const sensitivity = {
        sensitivity: 1,
        type: 'count' as const,
        groupBy: ['department']
      };
      
      const cost = analyzer.calculateEpsilonCost(sensitivity, 3, 1.0);
      expect(cost).toBeCloseTo(0.333, 3);
    });

    it('should apply higher cost for average queries', () => {
      const sensitivity = {
        sensitivity: 1,
        type: 'average' as const
      };
      
      const cost = analyzer.calculateEpsilonCost(sensitivity, 1, 1.0);
      expect(cost).toBe(2.0);
    });
  });

  describe('Query Validation', () => {
    it('should validate correct queries', () => {
      const validQuery = 'SELECT COUNT(*) FROM users';
      expect(analyzer.validateQuery(validQuery)).toBe(true);
    });

    it('should reject invalid queries', () => {
      const invalidQuery = 'INVALID QUERY';
      expect(analyzer.validateQuery(invalidQuery)).toBe(false);
    });
  });
});

describe('Privacy Budget Manager', () => {
  let budgetManager: PrivacyBudgetManager;

  beforeAll(async () => {
    budgetManager = await PrivacyBudgetManager.getInstance();
  });

  describe('Budget Management', () => {
    const testDataset = 'test_dataset';

    beforeEach(async () => {
      await budgetManager.initializeBudget(testDataset, 10.0, 1e-10);
    });

    afterEach(async () => {
      await budgetManager.deleteBudget(testDataset);
    });

    it('should initialize budget for dataset', async () => {
      const budget = await budgetManager.getBudget(testDataset);
      
      expect(budget).toBeTruthy();
      expect(budget!.dataset).toBe(testDataset);
      expect(budget!.epsilon).toBe(10.0);
      expect(budget!.remaining).toBe(10.0);
    });

    it('should consume epsilon budget', async () => {
      const initialBudget = await budgetManager.getBudget(testDataset);
      const epsilonCost = 2.0;
      
      const updatedBudget = await budgetManager.consumeBudget(testDataset, epsilonCost);
      
      expect(updatedBudget.remaining).toBe(8.0);
      expect(updatedBudget.remaining).toBeLessThan(initialBudget!.remaining);
    });

    it('should throw error when budget exhausted', async () => {
      await budgetManager.consumeBudget(testDataset, 8.0);
      
      await expect(
        budgetManager.consumeBudget(testDataset, 5.0)
      ).rejects.toThrow('Insufficient privacy budget');
    });

    it('should check budget availability', async () => {
      const canAfford = await budgetManager.checkBudget(testDataset, 5.0);
      expect(canAfford).toBe(true);
      
      const cannotAfford = await budgetManager.checkBudget(testDataset, 15.0);
      expect(cannotAfford).toBe(false);
    });

    it('should calculate budget usage percentage', async () => {
      await budgetManager.consumeBudget(testDataset, 3.0);
      
      const usage = await budgetManager.getBudgetUsage(testDataset);
      expect(usage).toBeCloseTo(30.0, 1);
    });

    it('should reset budget', async () => {
      await budgetManager.consumeBudget(testDataset, 5.0);
      await budgetManager.resetBudget(testDataset);
      
      const budget = await budgetManager.getBudget(testDataset);
      expect(budget!.remaining).toBe(10.0);
    });
  });
});
