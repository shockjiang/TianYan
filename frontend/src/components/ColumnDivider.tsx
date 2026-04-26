interface ColumnDividerProps {
  onDragStart: (e: React.MouseEvent) => void;
}

export function ColumnDivider({ onDragStart }: ColumnDividerProps) {
  return <div className="column-divider" onMouseDown={onDragStart} />;
}
