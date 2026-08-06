import React from 'react';
import { STATUS_LABEL, STATUS_TONE } from '../../constants';

export type BadgeTone = 'green' | 'rose' | 'amber' | 'sky' | 'indigo' | 'slate' | 'violet';

const TONE_CLASS: Record<BadgeTone, string> = {
  green: 'badge-green',
  rose: 'badge-rose',
  amber: 'badge-amber',
  sky: 'badge-sky',
  indigo: 'badge-indigo',
  slate: 'badge-slate',
  violet: 'badge-violet',
};

interface BadgeProps {
  status: string;
  label?: string;
  tone?: BadgeTone;
  className?: string;
}

/**
 * Badge canónico de estado (F6). El mapeo status→tono vive en constants.ts.
 */
export const Badge: React.FC<BadgeProps> = ({ status, label, tone, className }) => {
  const resolvedTone = tone ?? (STATUS_TONE[status] as BadgeTone | undefined) ?? 'slate';
  return (
    <span className={`badge ${TONE_CLASS[resolvedTone]} ${className ?? ''}`}>
      {label ?? STATUS_LABEL[status] ?? status}
    </span>
  );
};