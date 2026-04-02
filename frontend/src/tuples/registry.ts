import type { TupleType } from '../types';

const registry: TupleType[] = [];

export function registerTuple(tupleType: TupleType) {
  const existing = registry.findIndex(t => t.key === tupleType.key);
  if (existing >= 0) registry[existing] = tupleType;
  else registry.push(tupleType);
}

export function getTupleTypes(): TupleType[] {
  return [...registry];
}

export function getTupleByKey(key: string): TupleType | undefined {
  return registry.find(t => t.key === key);
}
