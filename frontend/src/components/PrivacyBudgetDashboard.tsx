import React, { useState, useEffect, useCallback } from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, LineChart, Line, XAxis, YAxis, CartesianGrid, Legend } from 'recharts';
import { AlertCircle, Info, TrendingDown, Calendar, Shield } from 'lucide-react';
import { toast } from 'react-hot-toast';
import axios from 'axios';
import { format, subDays, startOfDay } from 'date-fns';

// Types
interface PrivacyBudget {
  datasetId: string;
  datasetName: string;
  currentEpsilon: number;
  maxEpsilon: number;
  percentageUsed: number;
  lastUpdated: string;
  status: 'healthy' | 'warning' | 'critical';
}

interface BudgetHistory {
  date: string;
  epsilon: number;
  percentageUsed: number;
  operation: string;
}

interface ApiResponse {
  success: boolean;
  data: PrivacyBudget;
  history: BudgetHistory[];
}

const PrivacyBudgetDashboard: React.FC<{ datasetId: string }> = ({ datasetId }) => {
  const [budget, setBudget] = useState<PrivacyBudget | null>(null);
  const [history, setHistory] = useState<BudgetHistory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [alertShown, setAlertShown] = useState(false);

  // Color coding based on budget consumption
  const getBudgetColor = useCallback((percentage: number) => {
    if (percentage >= 90) return '#ef4444'; // Red
    if (percentage >= 70) return '#f59e0b'; // Yellow/Amber
    return '#10b981'; // Green
  }, []);

  const getStatusColor = useCallback((status: string) => {
    switch (status) {
      case 'critical': return '#ef4444';
      case 'warning': return '#f59e0b';
      case 'healthy': return '#10b981';
      default: return '#6b7280';
    }
  }, []);

  // Fetch budget data from backend
  const fetchBudgetData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      
      const response = await axios.get<ApiResponse>(`/api/v1/privacy/budget/${datasetId}`);
      
      if (response.data.success) {
        setBudget(response.data.data);
        setHistory(response.data.history || []);
        
        // Check for low budget alert
        if (response.data.data.percentageUsed >= 90 && !alertShown) {
          toast.error(
            `Privacy budget critically low! Only ${(100 - response.data.data.percentageUsed).toFixed(1)}% remaining.`,
            {
              duration: 5000,
              icon: <AlertCircle className="w-5 h-5" />,
            }
          );
          setAlertShown(true);
        } else if (response.data.data.percentageUsed >= 70 && response.data.data.percentageUsed < 90 && !alertShown) {
          toast.warning(
            `Privacy budget warning: ${(100 - response.data.data.percentageUsed).toFixed(1)}% remaining.`,
            {
              duration: 4000,
              icon: <TrendingDown className="w-5 h-5" />,
            }
          );
        }
      } else {
        setError('Failed to fetch budget data');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
      toast.error('Failed to load privacy budget data');
    } finally {
      setLoading(false);
    }
  }, [datasetId, alertShown]);

  // Generate mock history data for demonstration
  const generateMockHistory = useCallback((): BudgetHistory[] => {
    const history: BudgetHistory[] = [];
    const today = startOfDay(new Date());
    
    for (let i = 29; i >= 0; i--) {
      const date = format(subDays(today, i), 'yyyy-MM-dd');
      const baseEpsilon = 1.0;
      const consumption = Math.random() * 0.3; // Random consumption per day
      
      history.push({
        date,
        epsilon: Math.max(0, baseEpsilon - (consumption * (30 - i))),
        percentageUsed: Math.min(100, consumption * (30 - i) * 100),
        operation: i % 3 === 0 ? 'Query' : i % 3 === 1 ? 'Analysis' : 'Export'
      });
    }
    
    return history;
  }, []);

  useEffect(() => {
    fetchBudgetData();
    
    // Set up real-time updates every 30 seconds
    const interval = setInterval(fetchBudgetData, 30000);
    
    return () => clearInterval(interval);
  }, [fetchBudgetData]);

  // Prepare data for gauge chart
  const gaugeData = budget ? [
    { name: 'Used', value: budget.percentageUsed, color: getBudgetColor(budget.percentageUsed) },
    { name: 'Remaining', value: 100 - budget.percentageUsed, color: '#e5e7eb' }
  ] : [];

  // Custom tooltip for gauge chart
  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-white p-3 border border-gray-200 rounded-lg shadow-lg">
          <p className="text-sm font-semibold text-gray-900">
            {payload[0].name}: {payload[0].value.toFixed(1)}%
          </p>
          {budget && (
            <p className="text-xs text-gray-600 mt-1">
              ε = {budget.currentEpsilon.toFixed(3)} / {budget.maxEpsilon}
            </p>
          )}
        </div>
      );
    }
    return null;
  };

  // Epsilon explanation tooltip
  const EpsilonTooltip = () => (
    <div className="max-w-xs p-3 bg-white border border-gray-200 rounded-lg shadow-lg">
      <div className="flex items-start space-x-2">
        <Info className="w-4 h-4 text-blue-500 mt-0.5 flex-shrink-0" />
        <div>
          <h4 className="font-semibold text-sm text-gray-900">What is Epsilon (ε)?</h4>
          <p className="text-xs text-gray-600 mt-1">
            Epsilon measures privacy loss in differential privacy. Lower values mean stronger privacy protection. 
            Think of it as a privacy budget - each query spends some epsilon, and when it's depleted, 
            the data can no longer be queried safely.
          </p>
        </div>
      </div>
    </div>
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 bg-white rounded-lg border border-gray-200">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (error || !budget) {
    return (
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <div className="flex items-center space-x-2 text-red-600">
          <AlertCircle className="w-5 h-5" />
          <span className="text-sm font-medium">{error || 'No budget data available'}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center space-x-3">
            <Shield className="w-6 h-6 text-blue-600" />
            <div>
              <h2 className="text-xl font-bold text-gray-900">Privacy Budget</h2>
              <p className="text-sm text-gray-600">{budget.datasetName}</p>
            </div>
          </div>
          <div className="flex items-center space-x-2">
            <div className={`px-3 py-1 rounded-full text-xs font-medium text-white`}
                 style={{ backgroundColor: getStatusColor(budget.status) }}>
              {budget.status.toUpperCase()}
            </div>
          </div>
        </div>

        {/* Main Gauge Chart */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Gauge */}
          <div className="flex flex-col items-center">
            <h3 className="text-lg font-semibold text-gray-800 mb-4">Current Budget Status</h3>
            <ResponsiveContainer width="100%" height={250}>
              <PieChart>
                <Pie
                  data={gaugeData}
                  cx="50%"
                  cy="50%"
                  startAngle={180}
                  endAngle={0}
                  innerRadius={60}
                  outerRadius={80}
                  paddingAngle={2}
                  dataKey="value"
                >
                  {gaugeData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip content={<CustomTooltip />} />
              </PieChart>
            </ResponsiveContainer>
            
            {/* Center text */}
            <div className="relative -mt-32 text-center">
              <div className="text-3xl font-bold text-gray-900">
                {(100 - budget.percentageUsed).toFixed(1)}%
              </div>
              <div className="text-sm text-gray-600">Remaining</div>
              <div className="text-xs text-gray-500 mt-1">
                ε = {budget.currentEpsilon.toFixed(3)}
              </div>
            </div>
          </div>

          {/* Stats */}
          <div className="space-y-4">
            <div className="bg-gray-50 rounded-lg p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-gray-700">Current Epsilon</span>
                <span className="text-lg font-bold text-gray-900">
                  {budget.currentEpsilon.toFixed(3)}
                </span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div 
                  className="h-2 rounded-full transition-all duration-300"
                  style={{ 
                    width: `${budget.percentageUsed}%`,
                    backgroundColor: getBudgetColor(budget.percentageUsed)
                  }}
                ></div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="bg-blue-50 rounded-lg p-4">
                <div className="text-2xl font-bold text-blue-600">
                  {budget.maxEpsilon}
                </div>
                <div className="text-sm text-blue-800">Max Epsilon</div>
              </div>
              <div className="bg-green-50 rounded-lg p-4">
                <div className="text-2xl font-bold text-green-600">
                  {(budget.maxEpsilon - budget.currentEpsilon).toFixed(3)}
                </div>
                <div className="text-sm text-green-800">Remaining</div>
              </div>
            </div>

            <div className="flex items-center justify-between text-sm text-gray-600">
              <span>Last updated</span>
              <span>{format(new Date(budget.lastUpdated), 'MMM dd, HH:mm')}</span>
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-col sm:flex-row gap-3 mt-6">
          <button
            onClick={() => setShowHistory(!showHistory)}
            className="flex items-center justify-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            <Calendar className="w-4 h-4" />
            <span>{showHistory ? 'Hide' : 'Show'} History</span>
          </button>
          
          <button
            onClick={fetchBudgetData}
            className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
          >
            Refresh
          </button>
        </div>
      </div>

      {/* History View */}
      {showHistory && (
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <h3 className="text-lg font-semibold text-gray-800 mb-4">
            30-Day Budget History
          </h3>
          
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={history.length > 0 ? history : generateMockHistory()}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis 
                dataKey="date" 
                tickFormatter={(value) => format(new Date(value), 'MMM dd')}
              />
              <YAxis 
                label={{ value: 'Epsilon (ε)', angle: -90, position: 'insideLeft' }}
                domain={[0, 'dataMax']}
              />
              <Tooltip 
                labelFormatter={(value) => format(new Date(value as string), 'MMM dd, yyyy')}
                formatter={(value: number) => [value.toFixed(3), 'Epsilon']}
              />
              <Legend />
              <Line 
                type="monotone" 
                dataKey="epsilon" 
                stroke="#3b82f6" 
                strokeWidth={2}
                dot={{ fill: '#3b82f6', r: 3 }}
                name="Epsilon Remaining"
              />
              <Line 
                type="monotone" 
                dataKey="percentageUsed" 
                stroke="#ef4444" 
                strokeWidth={2}
                dot={{ fill: '#ef4444', r: 3 }}
                name="Percentage Used"
                yAxisId="right"
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Epsilon Info Card */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <div className="flex items-start space-x-3">
          <Info className="w-5 h-5 text-blue-600 mt-0.5 flex-shrink-0" />
          <div>
            <h4 className="font-semibold text-blue-900">Understanding Privacy Budget</h4>
            <p className="text-sm text-blue-800 mt-1">
              Your privacy budget (epsilon) represents the total amount of privacy loss allowed for this dataset. 
              Each analytics query consumes some of this budget. When the budget is depleted, no further queries can be made 
              to protect individual privacy. The system automatically monitors and alerts you when the budget gets low.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PrivacyBudgetDashboard;
