import type { Request, Response } from 'express';

/**
 * Marca un endpoint como deprecated en headers (RFC 8594) y registra una
 * advertencia única por ruta en logs. Los clientes que aún lo usan siguen
 * funcionando; se eliminarán al completar la migración (Fase F frontend).
 */
export function markDeprecated(route: string, replacement: string) {
  return (req: Request, res: Response, next: () => void): void => {
    res.setHeader('Deprecation', 'true');
    res.setHeader('Sunset', new Date(Date.now() + 90 * 24 * 3600 * 1000).toISOString());
    res.setHeader('X-Replacement', replacement);
    console.warn(`[DEPRECATED] ${route} usado por ${req.method} ${req.originalUrl} -> usar ${replacement}`);
    next();
  };
}