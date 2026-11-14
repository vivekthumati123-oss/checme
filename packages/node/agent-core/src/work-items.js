/**
 * Work item port. Real implementations (GitHub Issues, Jira, Azure DevOps) and the WorkItemRouter
 * live in @l2/work-items. This in-memory double is for tests and offline demos only.
 */
export class WorkItemProvider {
  async getWorkItem(id) { throw new Error("not implemented"); }
  async getChildren(id) { throw new Error("not implemented"); }
  async createChildItems(parentId, items) { throw new Error("not implemented"); }
  async addComment(id, text) { throw new Error("not implemented"); }
  async addLink(id, url, relation) { throw new Error("not implemented"); }
  async search(query, options) { throw new Error("not implemented"); }
}

export class InMemoryWorkItemProvider extends WorkItemProvider {
  constructor(items = {}) {
    super();
    this.items = structuredClone(items);
    this.links = [];
    this.comments = [];
    this.sequence = 1000;
  }

  async getWorkItem(id) {
    if (!this.items[id]) throw new Error(`Work item not found: ${id}`);
    return { acceptanceCriteria: [], tags: [], ...this.items[id] };
  }

  async getChildren(id) {
    return Object.values(this.items).filter((item) => item.parentId === id);
  }

  async createChildItems(parentId, items) {
    return items.map((item) => {
      const id = `TASK-${(this.sequence += 1)}`;
      this.items[id] = { ...item, id, parentId };
      return { id, url: `memory://work-items/${id}` };
    });
  }

  async addComment(id, text) {
    this.comments.push({ id, text });
    return { id: String(this.comments.length), url: null };
  }

  async addLink(id, url, relation) {
    this.links.push({ id, url, relation });
    return { id, url };
  }

  async search() {
    return Object.values(this.items);
  }
}
