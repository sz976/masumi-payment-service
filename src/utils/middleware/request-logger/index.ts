import { Request, Response, NextFunction } from 'express';
import { logger } from '@/utils/logger';

export const requestLogger = (req: Request, res: Response, next: NextFunction) => {
    const start = Date.now();

    // Log request details
    logger.info({
        method: req.method,
        url: req.url,
        ip: req.ip,
        userAgent: req.get('user-agent'),
        message: `Incoming ${req.method} request to ${req.url}`
    });

    // Add response listener to log the response
    res.on('finish', () => {
        const duration = Date.now() - start;
        logger.info({
            method: req.method,
            url: req.url,
            status: res.statusCode,
            duration: `${duration}ms`,
            message: `Completed ${req.method} ${req.url} with status ${res.statusCode} in ${duration}ms`
        });
    });

    next();
}; 