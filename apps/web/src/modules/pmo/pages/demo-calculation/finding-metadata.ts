import { AlertTriangle, type LucideIcon, TrendingDown, TrendingUp } from 'lucide-react';

export function issueMeta(issueType: string): {
  label: string;
  icon: LucideIcon;
  tone: 'warning' | 'danger' | 'secondary' | 'success';
} {
  const normalized = issueType.toLowerCase();
  if (normalized.includes('overbook')) {
    return { label: issueType, icon: TrendingUp, tone: 'warning' };
  }
  if (normalized.includes('idle')) {
    return { label: issueType, icon: TrendingDown, tone: 'secondary' };
  }
  if (
    normalized.includes('mismatch') ||
    normalized.includes('underlog') ||
    normalized.includes('overlog')
  ) {
    return { label: issueType, icon: AlertTriangle, tone: 'danger' };
  }
  if (normalized.includes('healthy')) {
    return { label: issueType, icon: TrendingUp, tone: 'success' };
  }
  return { label: issueType, icon: AlertTriangle, tone: 'secondary' };
}

export function ragAccentClass(color: string): string {
  if (color === 'red') return 'border-l-danger bg-danger-tint/30';
  if (color === 'yellow') return 'border-l-warning bg-warning-tint/30';
  if (color === 'green') return 'border-l-success bg-success-tint/30';
  return 'border-l-hairline-strong bg-surface-1';
}
