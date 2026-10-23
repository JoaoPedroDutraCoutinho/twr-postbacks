export interface SaleEventRow {
  id: string;
  platform: string;
  event_id: string;
  event_type: string;
  order_id: string;
  product_id: string;
  product_name: string;
  currency: string;
  amount_cents: number;
  customer_email: string;
  customer_name?: string | null;
  payload: any;
  event_created_at: Date;
  created_at: Date;
}

class MemoryDatabase {
  private events: SaleEventRow[] = [];
  private currentId = 1;

  reset() {
    this.events = [];
    this.currentId = 1;
  }

  insertEvent(row: Omit<SaleEventRow, 'id' | 'created_at'>): { rowCount: number; rows: { id: string }[] } {
    // Constraint de idempotência: UNIQUE (platform, event_id)
    const exists = this.events.some(
      (e) => e.platform === row.platform && e.event_id === row.event_id
    );

    if (exists) {
      return { rowCount: 0, rows: [] };
    }

    const id = String(this.currentId++);
    this.events.push({
      ...row,
      id,
      created_at: new Date(),
    });

    return { rowCount: 1, rows: [{ id }] };
  }

  getTotals(fromDate: Date, toDate: Date): any[] {
    const filtered = this.events.filter(
      (e) => e.event_created_at >= fromDate && e.event_created_at <= toDate
    );

    const currencies = Array.from(new Set(filtered.map((e) => e.currency))).sort();

    return currencies.map((curr) => {
      const items = filtered.filter((e) => e.currency === curr);
      const approved = items.filter((e) => e.event_type === 'approved');
      const refunded = items.filter((e) => e.event_type === 'refunded');

      const gross_cents = approved.reduce((acc, curr) => acc + curr.amount_cents, 0);
      const refunded_cents = refunded.reduce((acc, curr) => acc + curr.amount_cents, 0);

      return {
        currency: curr,
        gross_cents,
        refunded_cents,
        net_cents: gross_cents - refunded_cents,
        sales_count: approved.length,
        refunds_count: refunded.length,
      };
    });
  }

  getGrouped(fromDate: Date, toDate: Date, groupBy: 'day' | 'product' | 'platform'): any[] {
    const filtered = this.events.filter(
      (e) => e.event_created_at >= fromDate && e.event_created_at <= toDate
    );

    const groupsMap = new Map<string, { group_key: string; group_name?: string; currency: string; items: SaleEventRow[] }>();

    for (const item of filtered) {
      let groupKey = '';
      let groupName: string | undefined;

      if (groupBy === 'day') {
        groupKey = item.event_created_at.toISOString().slice(0, 10);
      } else if (groupBy === 'product') {
        groupKey = item.product_id;
        groupName = item.product_name;
      } else if (groupBy === 'platform') {
        groupKey = item.platform;
      }

      const mapKey = `${groupKey}_${item.currency}`;
      if (!groupsMap.has(mapKey)) {
        groupsMap.set(mapKey, { group_key: groupKey, group_name: groupName, currency: item.currency, items: [] });
      }
      groupsMap.get(mapKey)!.items.push(item);
    }

    const results: any[] = [];
    for (const group of groupsMap.values()) {
      const approved = group.items.filter((e) => e.event_type === 'approved');
      const refunded = group.items.filter((e) => e.event_type === 'refunded');

      const gross_cents = approved.reduce((acc, curr) => acc + curr.amount_cents, 0);
      const refunded_cents = refunded.reduce((acc, curr) => acc + curr.amount_cents, 0);

      results.push({
        group_key: group.group_key,
        group_name: group.group_name,
        currency: group.currency,
        gross_cents,
        refunded_cents,
        net_cents: gross_cents - refunded_cents,
        sales_count: approved.length,
        refunds_count: refunded.length,
      });
    }

    return results;
  }
}

export const memoryDb = new MemoryDatabase();
