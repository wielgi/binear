import { describe, expect, it } from 'vitest';
import { withoutFolders } from './sprintStats';

describe('withoutFolders', () => {
  it('drops a parent whose child is in the same sprint', () => {
    const tasks = [
      { id: 1, parentId: null },
      { id: 2, parentId: 1 },
      { id: 3, parentId: null },
    ];
    expect(withoutFolders(tasks).map((t) => t.id)).toEqual([2, 3]);
  });

  it('keeps a child whose parent is outside the sprint', () => {
    expect(withoutFolders([{ id: 2, parentId: 99 }]).map((t) => t.id)).toEqual([2]);
  });

  it('drops every level of a nested folder', () => {
    const tasks = [
      { id: 1, parentId: null },
      { id: 2, parentId: 1 },
      { id: 3, parentId: 2 },
    ];
    expect(withoutFolders(tasks).map((t) => t.id)).toEqual([3]);
  });
});
