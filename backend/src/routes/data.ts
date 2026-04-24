import { Router, Request, Response } from 'express';
import multer from 'multer';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { asyncHandler } from '../middleware/errorHandler';
import { logger } from '../utils/logger';
import { UploadManager } from '../services/uploadManager';

const router = Router();
const uploadManager = new UploadManager();

// Initialize WebSocket for progress updates
export const initializeUploadSocket = (server: any) => {
  const io = new SocketIOServer(server, {
    cors: {
      origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
      methods: ['GET', 'POST']
    }
  });

  io.on('connection', (socket) => {
    logger.info(`Client connected for upload progress: ${socket.id}`);
    
    socket.on('join-upload', (uploadId) => {
      socket.join(`upload-${uploadId}`);
      logger.info(`Client ${socket.id} joined upload room: ${uploadId}`);
    });
    
    socket.on('disconnect', () => {
      logger.info(`Client disconnected: ${socket.id}`);
    });
  });
  
  return io;
};

// Upload configuration
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: {
    fileSize: 1024 * 1024 * 1024, // 1GB max file size
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['text/csv', 'application/json', 'application/octet-stream'];
    if (allowedTypes.includes(file.mimetype) || file.originalname.endsWith('.parquet')) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only CSV, JSON, and Parquet files are allowed.'));
    }
  }
});

// Upload data (chunked)
router.post('/upload', upload.single('file'), asyncHandler(async (req: Request, res: Response) => {
  const file = req.file;
  const { chunkIndex, totalChunks, uploadId, fileName, fileSize } = req.body;
  
  if (!file) {
    return res.status(400).json({ error: 'No file provided' });
  }
  
  try {
    const result = await uploadManager.processChunk({
      uploadId: uploadId || `upload-${Date.now()}`,
      fileName: fileName || file.originalname,
      fileSize: parseInt(fileSize) || file.size,
      chunkData: file.buffer,
      chunkIndex: parseInt(chunkIndex) || 0,
      totalChunks: parseInt(totalChunks) || 1
    });
    
    return res.json(result);
  } catch (error) {
    logger.error('Upload error:', error);
    return res.status(500).json({ error: 'Upload failed' });
  }
}));

// Initialize upload
router.post('/upload/init', asyncHandler(async (req: Request, res: Response) => {
  const { fileName, fileSize } = req.body;
  
  if (!fileName || !fileSize) {
    return res.status(400).json({ error: 'File name and size are required' });
  }
  
  const uploadId = uploadManager.initializeUpload(fileName, parseInt(fileSize));
  
  return res.json({
    uploadId,
    chunkSize: uploadManager.CHUNK_SIZE,
    maxChunks: Math.ceil(fileSize / uploadManager.CHUNK_SIZE)
  });
}));

// Get upload progress
router.get('/upload/:uploadId/progress', asyncHandler(async (req: Request, res: Response) => {
  const { uploadId } = req.params;
  const progress = uploadManager.getProgress(uploadId);
  
  if (!progress) {
    return res.status(404).json({ error: 'Upload not found' });
  }
  
  return res.json(progress);
}));

// Pause upload
router.post('/upload/:uploadId/pause', asyncHandler(async (req: Request, res: Response) => {
  const { uploadId } = req.params;
  const success = uploadManager.pauseUpload(uploadId);
  
  if (!success) {
    return res.status(404).json({ error: 'Upload not found' });
  }
  
  return res.json({ message: 'Upload paused' });
}));

// Resume upload
router.post('/upload/:uploadId/resume', asyncHandler(async (req: Request, res: Response) => {
  const { uploadId } = req.params;
  const success = uploadManager.resumeUpload(uploadId);
  
  if (!success) {
    return res.status(404).json({ error: 'Upload not found' });
  }
  
  return res.json({ message: 'Upload resumed' });
}));

// Cancel upload
router.delete('/upload/:uploadId', asyncHandler(async (req: Request, res: Response) => {
  const { uploadId } = req.params;
  const success = uploadManager.cancelUpload(uploadId);
  
  if (!success) {
    return res.status(404).json({ error: 'Upload not found' });
  }
  
  return res.json({ message: 'Upload cancelled' });
}));

// Get datasets
router.get('/', asyncHandler(async (req: Request, res: Response) => {
  res.json({
    datasets: [],
    message: 'Datasets retrieved successfully'
  });
}));

// Get dataset by ID
router.get('/:id', asyncHandler(async (req: Request, res: Response) => {
  res.json({
    dataset: {
      id: req.params.id,
      name: 'Sample Dataset',
      encrypted: true
    }
  });
}));

// Delete dataset
router.delete('/:id', asyncHandler(async (req: Request, res: Response) => {
  res.json({
    message: 'Dataset deleted successfully'
  });
}));

export { router as dataRoutes };
