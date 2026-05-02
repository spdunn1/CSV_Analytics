interface SkeletonProps {
  className?: string;
}

export function Skeleton({ className = '' }: SkeletonProps) {
  return (
    <div className={`animate-pulse bg-gray-200 dark:bg-gray-800 rounded ${className}`} />
  );
}

export function ChartSkeleton({ height = 200 }: { height?: number }) {
  return (
    <div className="card p-4" style={{ height }}>
      <Skeleton className="h-4 w-32 mb-3" />
      <Skeleton className="w-full" style={{ height: height - 60 }} />
    </div>
  );
}
