import type { ReactNode } from 'react'

export function EmptyState({
  title,
  hint,
  action,
}: {
  title: string
  hint?: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="surface flex flex-col items-center justify-center gap-3 px-6 py-14 text-center">
      <div className="text-base font-semibold">{title}</div>
      {hint && <div className="max-w-md text-sm text-text-muted">{hint}</div>}
      {action && <div className="mt-1">{action}</div>}
    </div>
  )
}
