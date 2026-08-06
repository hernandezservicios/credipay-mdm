import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface PaginationProps {
  page: number;
  perPage: number;
  total: number;
  onPageChange: (page: number) => void;
}

const ELLIPSIS = '…';

function computePages(current: number, total: number): (number | typeof ELLIPSIS)[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages: (number | typeof ELLIPSIS)[] = [1];
  if (current > 3) pages.push(ELLIPSIS);
  for (let p = Math.max(2, current - 1); p <= Math.min(total - 1, current + 1); p++) pages.push(p);
  if (current < total - 2) pages.push(ELLIPSIS);
  pages.push(total);
  return pages;
}

/**
 * Paginación canónica conectada al `pagination` del backend (F12): server-driven.
 */
export const Pagination: React.FC<PaginationProps> = ({ page, perPage, total, onPageChange }) => {
  if (total <= 1) return null;
  const pages = computePages(page, total);
  const from = (page - 1) * perPage + 1;
  const to = Math.min(page * perPage, total);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 mt-4">
      <p className="text-[11px] text-slate-500 dark:text-slate-400">
        {from}–{to} de {total}
      </p>
      <div className="flex items-center gap-1">
        <button
          className="btn-secondary btn-sm"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
          aria-label="Página anterior"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </button>
        {pages.map((p, i) =>
          p === ELLIPSIS ? (
            <span key={`e${i}`} className="px-1.5 text-xs text-slate-400">
              {ELLIPSIS}
            </span>
          ) : (
            <button
              key={p}
              onClick={() => onPageChange(p)}
              className={`btn-sm min-w-[32px] px-2 ${
                p === page ? 'btn-primary' : 'btn-secondary'
              }`}
            >
              {p}
            </button>
          )
        )}
        <button
          className="btn-secondary btn-sm"
          disabled={page >= total}
          onClick={() => onPageChange(page + 1)}
          aria-label="Página siguiente"
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
};