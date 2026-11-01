import type { ReactNode } from 'react';
import { cn } from '../../utils/format';

export type TableAlign = 'start' | 'center' | 'end';

export interface TableColumn<T> {
  key: string;
  header: ReactNode;
  /** Render a custom cell. Defaults to `row[key]`. */
  render?: (row: T) => ReactNode;
  align?: TableAlign;
  className?: string;
  headerClassName?: string;
  width?: string;
}

export interface TableProps<T> {
  columns: TableColumn<T>[];
  data: T[];
  keyExtractor: (row: T) => string | number;
  onRowClick?: (row: T) => void;
  loading?: boolean;
  emptyMessage?: ReactNode;
  className?: string;
  footer?: ReactNode;
}

const alignClasses: Record<TableAlign, string> = {
  start: 'text-start',
  center: 'text-center',
  end: 'text-end',
};

export function Table<T extends Record<string, unknown>>({
  columns,
  data,
  keyExtractor,
  onRowClick,
  loading = false,
  emptyMessage = 'Aucune donnée',
  className,
  footer,
}: TableProps<T>) {
  return (
    <div className={cn('card overflow-hidden', className)}>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-body">
          <thead className="bg-background">
            <tr>
              {columns.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  style={column.width ? { width: column.width } : undefined}
                  className={cn(
                    'border-b border-border px-4 py-2.5 text-label font-medium text-muted',
                    alignClasses[column.align ?? 'start'],
                    column.headerClassName,
                  )}
                >
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={columns.length} className="px-4 py-10 text-center text-muted">
                  Chargement…
                </td>
              </tr>
            ) : data.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="px-4 py-10 text-center text-muted">
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              data.map((row) => (
                <tr
                  key={keyExtractor(row)}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  className={cn(
                    'border-b border-border last:border-b-0 transition-colors hover:bg-background',
                    onRowClick && 'cursor-pointer',
                  )}
                >
                  {columns.map((column) => (
                    <td
                      key={column.key}
                      className={cn('px-4 py-3 text-foreground', alignClasses[column.align ?? 'start'], column.className)}
                    >
                      {column.render ? column.render(row) : ((row[column.key] as ReactNode) ?? '—')}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {footer && <div className="border-t border-border bg-white px-4 py-2.5 text-label text-muted">{footer}</div>}
    </div>
  );
}

export default Table;
