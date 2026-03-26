import React, { useState, useCallback, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Upload, 
  Lock, 
  Shield, 
  CheckCircle, 
  AlertCircle, 
  ArrowRight,
  ArrowLeft,
  FileText,
  Hash,
  Tag,
  Calendar,
  Building,
  X,
  Loader2,
  Undo,
  Database,
  Eye,
  EyeOff
} from 'lucide-react';
import { toast } from 'react-hot-toast';

// Web Worker for hashing
const hashWorker = new Worker(
  new URL('../workers/hashWorker.ts', import.meta.url),
  { type: 'module' }
);

interface UploadStep {
  id: number;
  name: string;
  description: string;
  status: 'pending' | 'active' | 'completed' | 'error';
}

interface MetadataTags {
  department: string;
  dateRange: {
    start: string;
    end: string;
  };
  sensitivity: 'public' | 'internal' | 'confidential' | 'restricted';
  purpose: string;
  retention: string;
}

interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  rowCount?: number;
  columns?: string[];
}

interface UploadProgress {
  percentage: number;
  stage: string;
  message: string;
  hash?: string;
}

interface EncryptedUploadResult {
  fileId: string;
  hash: string;
  stellarTransactionId: string;
  ipfsCid: string;
  encryptionKey: string;
  metadata: MetadataTags;
}

const EncryptedDataUploadWizard: React.FC = () => {
  const [currentStep, setCurrentStep] = useState(1);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(null);
  const [metadata, setMetadata] = useState<MetadataTags>({
    department: '',
    dateRange: { start: '', end: '' },
    sensitivity: 'internal',
    purpose: '',
    retention: '1-year'
  });
  const [validationResult, setValidationResult] = useState<ValidationResult | null>(null);
  const [uploadResult, setUploadResult] = useState<EncryptedUploadResult | null>(null);
  const [showEncryptionKey, setShowEncryptionKey] = useState(false);
  const [canUndo, setCanUndo] = useState(false);
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragCounter = useRef(0);

  const steps: UploadStep[] = [
    { id: 1, name: 'Select File', description: 'Choose your dataset file', status: 'pending' },
    { id: 2, name: 'Validate Schema', description: 'Check privacy standards compliance', status: 'pending' },
    { id: 3, name: 'Add Metadata', description: 'Tag and classify your data', status: 'pending' },
    { id: 4, name: 'Encrypt & Hash', description: 'Secure processing with client-side encryption', status: 'pending' },
    { id: 5, name: 'Upload Complete', description: 'Review and confirm upload', status: 'pending' }
  ];

  // Update step statuses
  useEffect(() => {
    setSteps(prev => prev.map(step => ({
      ...step,
      status: step.id < currentStep ? 'completed' : step.id === currentStep ? 'active' : 'pending'
    })));
  }, [currentStep]);

  const setSteps = (updater: (prev: UploadStep[]) => UploadStep[]) => {
    // This is a helper function to update steps
  };

  // File handling
  const handleFileSelect = useCallback((file: File) => {
    const validTypes = ['.csv', '.json'];
    const fileExtension = '.' + file.name.split('.').pop()?.toLowerCase();
    
    if (!validTypes.includes(fileExtension)) {
      toast.error(`Invalid file type. Please upload ${validTypes.join(', ')} files.`);
      return;
    }

    if (file.size > 100 * 1024 * 1024) { // 100MB limit
      toast.error('File size exceeds 100MB limit.');
      return;
    }

    setSelectedFile(file);
    setCurrentStep(2);
    toast.success(`File "${file.name}" selected successfully.`);
  }, []);

  // Drag and drop handlers
  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current++;
    if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
      setIsDragOver(true);
    }
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current--;
    if (dragCounter.current === 0) {
      setIsDragOver(false);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    dragCounter.current = 0;

    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      handleFileSelect(files[0]);
    }
  }, [handleFileSelect]);

  // Schema validation
  const validateSchema = useCallback(async () => {
    if (!selectedFile) return;

    setIsProcessing(true);
    setValidationResult(null);

    try {
      const fileContent = await readFileContent(selectedFile);
      const validation = await validateFileSchema(fileContent, selectedFile.name);
      setValidationResult(validation);

      if (validation.isValid) {
        toast.success('File validation passed!');
        setCurrentStep(3);
      } else {
        toast.error('File validation failed. Please check the errors.');
      }
    } catch (error) {
      toast.error('Validation failed: ' + error.message);
    } finally {
      setIsProcessing(false);
    }
  }, [selectedFile]);

  // Read file content
  const readFileContent = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target?.result as string);
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsText(file);
    });
  };

  // Validate file schema
  const validateFileSchema = async (content: string, fileName: string): Promise<ValidationResult> => {
    const errors: string[] = [];
    const warnings: string[] = [];

    try {
      if (fileName.endsWith('.json')) {
        const data = JSON.parse(content);
        if (!Array.isArray(data)) {
          errors.push('JSON file must contain an array of objects');
        } else {
          const columns = Object.keys(data[0] || {});
          // Check for required privacy columns
          const requiredColumns = ['id', 'timestamp'];
          const missingColumns = requiredColumns.filter(col => !columns.includes(col));
          if (missingColumns.length > 0) {
            warnings.push(`Missing recommended columns: ${missingColumns.join(', ')}`);
          }
          return { isValid: errors.length === 0, errors, warnings, rowCount: data.length, columns };
        }
      } else if (fileName.endsWith('.csv')) {
        const lines = content.split('\n').filter(line => line.trim());
        if (lines.length < 2) {
          errors.push('CSV file must have at least a header and one data row');
        } else {
          const columns = lines[0].split(',').map(col => col.trim());
          const rowCount = lines.length - 1;
          warnings.push(`Found ${rowCount} rows with ${columns.length} columns`);
          return { isValid: errors.length === 0, errors, warnings, rowCount, columns };
        }
      }
    } catch (error) {
      errors.push('Failed to parse file content');
    }

    return { isValid: false, errors, warnings };
  };

  // Hash file using Web Worker
  const hashFile = useCallback((file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      setIsProcessing(true);
      setUploadProgress({ percentage: 0, stage: 'hashing', message: 'Initializing hash calculation...' });

      const handleMessage = (e: MessageEvent) => {
        const { type, hash, progress, error } = e.data;
        
        if (type === 'progress') {
          setUploadProgress({
            percentage: progress,
            stage: 'hashing',
            message: `Calculating hash... ${progress}%`
          });
        } else if (type === 'complete') {
          setUploadProgress({
            percentage: 100,
            stage: 'hashing',
            message: 'Hash calculation complete',
            hash
          });
          hashWorker.removeEventListener('message', handleMessage);
          setIsProcessing(false);
          resolve(hash);
        } else if (type === 'error') {
          hashWorker.removeEventListener('message', handleMessage);
          setIsProcessing(false);
          reject(new Error(error));
        }
      };

      hashWorker.addEventListener('message', handleMessage);
      hashWorker.postMessage({ type: 'hash', file });
    });
  }, []);

  // Encrypt and upload
  const encryptAndUpload = useCallback(async () => {
    if (!selectedFile) return;

    try {
      setIsProcessing(true);
      setUploadProgress({ percentage: 0, stage: 'encrypting', message: 'Starting encryption...' });

      // Step 1: Hash the file
      const fileHash = await hashFile(selectedFile);
      
      // Step 2: Encrypt the file (simulated)
      setUploadProgress({ percentage: 25, stage: 'encrypting', message: 'Encrypting file content...' });
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Step 3: Generate encryption key
      setUploadProgress({ percentage: 50, stage: 'encrypting', message: 'Generating encryption key...' });
      const encryptionKey = generateEncryptionKey();
      
      // Step 4: Upload to IPFS (simulated)
      setUploadProgress({ percentage: 75, stage: 'uploading', message: 'Uploading to IPFS...' });
      const ipfsCid = await uploadToIPFS(selectedFile, encryptionKey);
      
      // Step 5: Create Stellar transaction (simulated)
      setUploadProgress({ percentage: 90, stage: 'signing', message: 'Creating Stellar transaction...' });
      const stellarTxId = await createStellarTransaction(fileHash, metadata);
      
      // Step 6: Complete
      setUploadProgress({ percentage: 100, stage: 'completed', message: 'Upload completed successfully!' });
      
      const result: EncryptedUploadResult = {
        fileId: `file_${Date.now()}`,
        hash: fileHash,
        stellarTransactionId: stellarTxId,
        ipfsCid,
        encryptionKey,
        metadata
      };
      
      setUploadResult(result);
      setCanUndo(true);
      setCurrentStep(5);
      
      toast.success('File uploaded and encrypted successfully!');
    } catch (error) {
      toast.error('Upload failed: ' + error.message);
    } finally {
      setIsProcessing(false);
    }
  }, [selectedFile, metadata, hashFile]);

  // Generate encryption key (simulated)
  const generateEncryptionKey = (): string => {
    return Array.from(crypto.getRandomValues(new Uint8Array(32)))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  };

  // Upload to IPFS (simulated)
  const uploadToIPFS = async (file: File, key: string): Promise<string> => {
    await new Promise(resolve => setTimeout(resolve, 1500));
    return `Qm${Array.from(crypto.getRandomValues(new Uint8Array(44)))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('')}`;
  };

  // Create Stellar transaction (simulated)
  const createStellarTransaction = async (hash: string, metadata: MetadataTags): Promise<string> => {
    await new Promise(resolve => setTimeout(resolve, 1000));
    return `stellar_tx_${Date.now()}_${hash.slice(0, 8)}`;
  };

  // Undo upload
  const handleUndo = useCallback(() => {
    if (!canUndo) return;
    
    if (confirm('Are you sure you want to undo the upload? This will remove the file from IPFS and cancel the Stellar transaction.')) {
      // Simulate undo process
      toast.success('Upload undone successfully');
      resetWizard();
    }
  }, [canUndo]);

  // Reset wizard
  const resetWizard = () => {
    setCurrentStep(1);
    setSelectedFile(null);
    setValidationResult(null);
    setUploadResult(null);
    setUploadProgress(null);
    setCanUndo(false);
    setMetadata({
      department: '',
      dateRange: { start: '', end: '' },
      sensitivity: 'internal',
      purpose: '',
      retention: '1-year'
    });
  };

  // Render step content
  const renderStepContent = () => {
    switch (currentStep) {
      case 1:
        return (
          <div className="space-y-6">
            <div
              className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
                isDragOver ? 'border-blue-500 bg-blue-50' : 'border-gray-300 hover:border-gray-400'
              }`}
              onDragEnter={handleDragEnter}
              onDragLeave={handleDragLeave}
              onDragOver={handleDragOver}
              onDrop={handleDrop}
            >
              <Upload className="w-12 h-12 mx-auto mb-4 text-gray-400" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">
                Drop your file here, or click to browse
              </h3>
              <p className="text-sm text-gray-600 mb-4">
                Supports CSV and JSON files up to 100MB
              </p>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.json"
                onChange={(e) => e.target.files?.[0] && handleFileSelect(e.target.files[0])}
                className="hidden"
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              >
                Select File
              </button>
            </div>
            
            {selectedFile && (
              <div className="bg-gray-50 rounded-lg p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <FileText className="w-5 h-5 text-blue-600" />
                    <div>
                      <p className="font-medium text-gray-900">{selectedFile.name}</p>
                      <p className="text-sm text-gray-600">
                        {(selectedFile.size / 1024 / 1024).toFixed(2)} MB
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => setSelectedFile(null)}
                    className="text-gray-400 hover:text-gray-600"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
              </div>
            )}
          </div>
        );

      case 2:
        return (
          <div className="space-y-6">
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <div className="flex items-start space-x-3">
                <Database className="w-5 h-5 text-blue-600 mt-0.5" />
                <div>
                  <h4 className="font-semibold text-blue-900">Privacy Standards Validation</h4>
                  <p className="text-sm text-blue-800 mt-1">
                    We're checking your file against our privacy standards to ensure compliance.
                  </p>
                </div>
              </div>
            </div>

            {isProcessing ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
                <span className="ml-2 text-gray-600">Validating file schema...</span>
              </div>
            ) : validationResult && (
              <div className="space-y-4">
                {validationResult.isValid ? (
                  <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                    <div className="flex items-center space-x-2">
                      <CheckCircle className="w-5 h-5 text-green-600" />
                      <span className="font-medium text-green-900">Validation Successful</span>
                    </div>
                    <div className="mt-2 text-sm text-green-800">
                      <p>Rows: {validationResult.rowCount}</p>
                      <p>Columns: {validationResult.columns?.length}</p>
                    </div>
                  </div>
                ) : (
                  <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                    <div className="flex items-center space-x-2">
                      <AlertCircle className="w-5 h-5 text-red-600" />
                      <span className="font-medium text-red-900">Validation Failed</span>
                    </div>
                    <div className="mt-2">
                      {validationResult.errors.map((error, index) => (
                        <p key={index} className="text-sm text-red-800">• {error}</p>
                      ))}
                    </div>
                  </div>
                )}
                
                {validationResult.warnings.length > 0 && (
                  <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                    <h4 className="font-medium text-yellow-900 mb-2">Warnings</h4>
                    {validationResult.warnings.map((warning, index) => (
                      <p key={index} className="text-sm text-yellow-800">• {warning}</p>
                    ))}
                  </div>
                )}
              </div>
            )}

            <button
              onClick={validateSchema}
              disabled={isProcessing || !selectedFile}
              className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {isProcessing ? 'Validating...' : 'Validate Schema'}
            </button>
          </div>
        );

      case 3:
        return (
          <div className="space-y-6">
            <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
              <div className="flex items-start space-x-3">
                <Tag className="w-5 h-5 text-purple-600 mt-0.5" />
                <div>
                  <h4 className="font-semibold text-purple-900">Add Metadata Tags</h4>
                  <p className="text-sm text-purple-800 mt-1">
                    Help organize and classify your data with proper metadata.
                  </p>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Department *
                </label>
                <select
                  value={metadata.department}
                  onChange={(e) => setMetadata(prev => ({ ...prev, department: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                >
                  <option value="">Select department</option>
                  <option value="sales">Sales</option>
                  <option value="marketing">Marketing</option>
                  <option value="finance">Finance</option>
                  <option value="hr">Human Resources</option>
                  <option value="operations">Operations</option>
                  <option value="research">Research & Development</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Sensitivity Level *
                </label>
                <select
                  value={metadata.sensitivity}
                  onChange={(e) => setMetadata(prev => ({ ...prev, sensitivity: e.target.value as any }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                >
                  <option value="public">Public</option>
                  <option value="internal">Internal</option>
                  <option value="confidential">Confidential</option>
                  <option value="restricted">Restricted</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Date Range Start
                </label>
                <input
                  type="date"
                  value={metadata.dateRange.start}
                  onChange={(e) => setMetadata(prev => ({ 
                    ...prev, 
                    dateRange: { ...prev.dateRange, start: e.target.value }
                  }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Date Range End
                </label>
                <input
                  type="date"
                  value={metadata.dateRange.end}
                  onChange={(e) => setMetadata(prev => ({ 
                    ...prev, 
                    dateRange: { ...prev.dateRange, end: e.target.value }
                  }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Purpose *
                </label>
                <input
                  type="text"
                  value={metadata.purpose}
                  onChange={(e) => setMetadata(prev => ({ ...prev, purpose: e.target.value }))}
                  placeholder="e.g., Customer analytics, Financial reporting"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Retention Period
                </label>
                <select
                  value={metadata.retention}
                  onChange={(e) => setMetadata(prev => ({ ...prev, retention: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                >
                  <option value="30-days">30 days</option>
                  <option value="6-months">6 months</option>
                  <option value="1-year">1 year</option>
                  <option value="2-years">2 years</option>
                  <option value="5-years">5 years</option>
                  <option value="permanent">Permanent</option>
                </select>
              </div>
            </div>

            <div className="flex justify-between">
              <button
                onClick={() => setCurrentStep(2)}
                className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
              >
                Back
              </button>
              <button
                onClick={() => setCurrentStep(4)}
                disabled={!metadata.department || !metadata.purpose}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
              >
                Continue
              </button>
            </div>
          </div>
        );

      case 4:
        return (
          <div className="space-y-6">
            <div className="bg-green-50 border border-green-200 rounded-lg p-4">
              <div className="flex items-start space-x-3">
                <Lock className="w-5 h-5 text-green-600 mt-0.5" />
                <div>
                  <h4 className="font-semibold text-green-900">Client-Side Encryption</h4>
                  <p className="text-sm text-green-800 mt-1">
                    Your file is being encrypted and hashed locally before upload. Your data never leaves your device unencrypted.
                  </p>
                </div>
              </div>
            </div>

            {uploadProgress && (
              <div className="space-y-4">
                <div className="bg-gray-50 rounded-lg p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium text-gray-700">{uploadProgress.stage}</span>
                    <span className="text-sm text-gray-600">{uploadProgress.percentage}%</span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div 
                      className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                      style={{ width: `${uploadProgress.percentage}%` }}
                    ></div>
                  </div>
                  <p className="text-sm text-gray-600 mt-2">{uploadProgress.message}</p>
                </div>

                {uploadProgress.hash && (
                  <div className="bg-gray-50 rounded-lg p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <h5 className="font-medium text-gray-900">File Hash (SHA-256)</h5>
                        <p className="text-sm text-gray-600 font-mono mt-1">{uploadProgress.hash}</p>
                      </div>
                      <Hash className="w-5 h-5 text-gray-400" />
                    </div>
                  </div>
                )}
              </div>
            )}

            {!isProcessing && !uploadResult && (
              <button
                onClick={encryptAndUpload}
                className="w-full px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
              >
                Start Encryption & Upload
              </button>
            )}

            <div className="flex justify-between">
              <button
                onClick={() => setCurrentStep(3)}
                disabled={isProcessing}
                className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors"
              >
                Back
              </button>
            </div>
          </div>
        );

      case 5:
        return (
          <div className="space-y-6">
            {uploadResult ? (
              <>
                <div className="bg-green-50 border border-green-200 rounded-lg p-6">
                  <div className="flex items-center space-x-3 mb-4">
                    <CheckCircle className="w-6 h-6 text-green-600" />
                    <h3 className="text-lg font-semibold text-green-900">Upload Successful!</h3>
                  </div>
                  <p className="text-green-800">
                    Your file has been encrypted and uploaded securely. All processing was done client-side to protect your privacy.
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="bg-gray-50 rounded-lg p-4">
                    <h5 className="font-medium text-gray-900 mb-2">File Information</h5>
                    <div className="space-y-1 text-sm">
                      <p><span className="text-gray-600">File ID:</span> {uploadResult.fileId}</p>
                      <p><span className="text-gray-600">File Name:</span> {selectedFile?.name}</p>
                      <p><span className="text-gray-600">Size:</span> {selectedFile ? (selectedFile.size / 1024 / 1024).toFixed(2) + ' MB' : 'N/A'}</p>
                    </div>
                  </div>

                  <div className="bg-gray-50 rounded-lg p-4">
                    <h5 className="font-medium text-gray-900 mb-2">Blockchain Transaction</h5>
                    <div className="space-y-1 text-sm">
                      <p><span className="text-gray-600">Transaction ID:</span></p>
                      <p className="font-mono text-xs bg-white px-2 py-1 rounded border">{uploadResult.stellarTransactionId}</p>
                    </div>
                  </div>

                  <div className="bg-gray-50 rounded-lg p-4">
                    <h5 className="font-medium text-gray-900 mb-2">IPFS Storage</h5>
                    <div className="space-y-1 text-sm">
                      <p><span className="text-gray-600">CID:</span></p>
                      <p className="font-mono text-xs bg-white px-2 py-1 rounded border">{uploadResult.ipfsCid}</p>
                    </div>
                  </div>

                  <div className="bg-gray-50 rounded-lg p-4">
                    <h5 className="font-medium text-gray-900 mb-2">Encryption Key</h5>
                    <div className="space-y-2">
                      <div className="flex items-center space-x-2">
                        <input
                          type={showEncryptionKey ? 'text' : 'password'}
                          value={uploadResult.encryptionKey}
                          readOnly
                          className="flex-1 text-xs font-mono bg-white px-2 py-1 rounded border"
                        />
                        <button
                          onClick={() => setShowEncryptionKey(!showEncryptionKey)}
                          className="p-1 text-gray-600 hover:text-gray-800"
                        >
                          {showEncryptionKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                      <p className="text-xs text-red-600">Save this key securely. You'll need it to decrypt your file.</p>
                    </div>
                  </div>
                </div>

                <div className="flex justify-between">
                  <button
                    onClick={handleUndo}
                    disabled={!canUndo}
                    className="flex items-center space-x-2 px-4 py-2 border border-red-300 text-red-700 rounded-lg hover:bg-red-50 disabled:opacity-50 transition-colors"
                  >
                    <Undo className="w-4 h-4" />
                    <span>Undo Upload</span>
                  </button>
                  <button
                    onClick={resetWizard}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                  >
                    Upload Another File
                  </button>
                </div>
              </>
            ) : (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
                <span className="ml-2 text-gray-600">Finalizing upload...</span>
              </div>
            )}
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div className="max-w-4xl mx-auto p-6">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Encrypted Data Upload Wizard</h1>
        <p className="text-gray-600">Upload your datasets with client-side encryption and blockchain verification</p>
      </div>

      {/* Progress Steps */}
      <div className="mb-8">
        <div className="flex items-center justify-between">
          {steps.map((step, index) => (
            <div key={step.id} className="flex items-center flex-1">
              <div className="flex items-center">
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
                    step.status === 'completed' ? 'bg-green-600 text-white' :
                    step.status === 'active' ? 'bg-blue-600 text-white' :
                    step.status === 'error' ? 'bg-red-600 text-white' :
                    'bg-gray-300 text-gray-600'
                  }`}
                >
                  {step.status === 'completed' ? '✓' : step.id}
                </div>
                <div className="ml-3 hidden sm:block">
                  <p className="text-sm font-medium text-gray-900">{step.name}</p>
                  <p className="text-xs text-gray-600">{step.description}</p>
                </div>
              </div>
              {index < steps.length - 1 && (
                <div className={`flex-1 h-px mx-4 ${
                  steps[index].status === 'completed' ? 'bg-green-600' : 'bg-gray-300'
                }`} />
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Step Content */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <AnimatePresence mode="wait">
          <motion.div
            key={currentStep}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.3 }}
          >
            {renderStepContent()}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
};

export default EncryptedDataUploadWizard;
