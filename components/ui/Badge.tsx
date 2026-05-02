interface BadgeProps {
  status: 'clean' | 'issues' | 'limited' | 'pending' | 'processing';
  className?: string;
}

const labels: Record<BadgeProps['status'], string> = {
  clean: 'Clean',
  issues: 'Issues',
  limited: 'Limited',
  pending: 'Pending',
  processing: 'Processing',
};

const styles: Record<BadgeProps['status'], string> = {
  clean: 'badge-clean',
  issues: 'badge-issues',
  limited: 'badge-limited',
  pending: 'badge-pending',
  processing: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300',
};

export function Badge({ status, className = '' }: BadgeProps) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${styles[status]} ${className}`}>
      {labels[status]}
    </span>
  );
}
