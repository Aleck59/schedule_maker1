import { useState, type ReactNode } from 'react';
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from '@tanstack/react-table';
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';

/** Таблица на TanStack Table: сортировка, поиск, постраничный вывод */
export function DataTable<T>({
  data,
  columns,
  searchPlaceholder = 'Поиск…',
  searchable = true,
  pageSize = 50,
  onRowClick,
  toolbar,
  emptyText = 'Нет данных',
  rowClassName,
  initialSorting = [],
  dense,
}: {
  data: T[];
  columns: ColumnDef<T, any>[];
  searchPlaceholder?: string;
  searchable?: boolean;
  pageSize?: number | null;
  onRowClick?: (row: T) => void;
  toolbar?: ReactNode;
  emptyText?: string;
  rowClassName?: (row: T) => string | undefined;
  initialSorting?: SortingState;
  dense?: boolean;
}) {
  const [sorting, setSorting] = useState<SortingState>(initialSorting);
  const [globalFilter, setGlobalFilter] = useState('');
  const table = useReactTable({
    data,
    columns,
    state: { sorting, globalFilter },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    ...(pageSize ? { getPaginationRowModel: getPaginationRowModel(), initialState: { pagination: { pageSize } } } : {}),
    globalFilterFn: 'includesString',
  });
  const rows = table.getRowModel().rows;
  return (
    <div className="space-y-3">
      {(searchable || toolbar) && (
        <div className="flex flex-wrap items-center gap-2">
          {searchable && (
            <div className="relative w-full max-w-xs">
              <Search className="text-muted-foreground absolute top-2.5 left-2.5 size-4" />
              <Input
                value={globalFilter}
                onChange={(e) => setGlobalFilter(e.target.value)}
                placeholder={searchPlaceholder}
                className="pl-8"
              />
            </div>
          )}
          {toolbar}
        </div>
      )}
      <div className="bg-card overflow-hidden rounded-lg border">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((hg) => (
              <TableRow key={hg.id} className="hover:bg-transparent">
                {hg.headers.map((header) => {
                  const canSort = header.column.getCanSort();
                  const dir = header.column.getIsSorted();
                  return (
                    <TableHead
                      key={header.id}
                      colSpan={header.colSpan}
                      className={cn(canSort && 'cursor-pointer select-none', (header.column.columnDef.meta as { className?: string })?.className)}
                      onClick={canSort ? header.column.getToggleSortingHandler() : undefined}
                    >
                      {header.isPlaceholder ? null : (
                        <span className="inline-flex items-center gap-1">
                          {flexRender(header.column.columnDef.header, header.getContext())}
                          {canSort &&
                            (dir === 'asc' ? (
                              <ArrowUp className="size-3" />
                            ) : dir === 'desc' ? (
                              <ArrowDown className="size-3" />
                            ) : (
                              <ArrowUpDown className="size-3 opacity-30" />
                            ))}
                        </span>
                      )}
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={columns.length} className="text-muted-foreground h-20 text-center">
                  {emptyText}
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => (
                <TableRow
                  key={row.id}
                  className={cn(onRowClick && 'cursor-pointer', rowClassName?.(row.original))}
                  onClick={onRowClick ? () => onRowClick(row.original) : undefined}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell
                      key={cell.id}
                      className={cn(dense && 'py-1.5', (cell.column.columnDef.meta as { className?: string })?.className)}
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
      {pageSize && table.getPageCount() > 1 && (
        <div className="text-muted-foreground flex items-center justify-between text-sm">
          <span>
            Записей: {table.getFilteredRowModel().rows.length} · страница {table.getState().pagination.pageIndex + 1} из{' '}
            {table.getPageCount()}
          </span>
          <div className="flex gap-1">
            <Button variant="outline" size="icon-sm" onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()}>
              <ChevronLeft />
            </Button>
            <Button variant="outline" size="icon-sm" onClick={() => table.nextPage()} disabled={!table.getCanNextPage()}>
              <ChevronRight />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
