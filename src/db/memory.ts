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

class BancoEmMemoria {
  private eventos: SaleEventRow[] = [];
  private id_atual = 1;

  reset() {
    this.eventos = [];
    this.id_atual = 1;
  }

  inserir_evento(linha_registro: Omit<SaleEventRow, 'id' | 'created_at'>): { rowCount: number; rows: { id: string }[] } {
    // Constraint de idempotencia: UNIQUE (platform, event_id)
    const ja_existe = this.eventos.some(
      (evento) => evento.platform === linha_registro.platform && evento.event_id === linha_registro.event_id
    );

    if (ja_existe) {
      return { rowCount: 0, rows: [] };
    }

    const id = String(this.id_atual++);
    this.eventos.push({
      ...linha_registro,
      id,
      created_at: new Date(),
    });

    return { rowCount: 1, rows: [{ id }] };
  }

  insertEvent(linha_registro: Omit<SaleEventRow, 'id' | 'created_at'>) {
    return this.inserir_evento(linha_registro);
  }

  obter_totais(data_inicio: Date, data_fim: Date): any[] {
    const eventos_filtrados = this.eventos.filter(
      (evento) => evento.event_created_at >= data_inicio && evento.event_created_at <= data_fim
    );

    const lista_moedas = Array.from(new Set(eventos_filtrados.map((evento) => evento.currency))).sort();

    return lista_moedas.map((moeda) => {
      const itens_moeda = eventos_filtrados.filter((evento) => evento.currency === moeda);
      const vendas_aprovadas = itens_moeda.filter((evento) => evento.event_type === 'approved');
      const reembolsos = itens_moeda.filter((evento) => evento.event_type === 'refunded');

      const gross_cents = vendas_aprovadas.reduce((acumulado, item) => acumulado + item.amount_cents, 0);
      const refunded_cents = reembolsos.reduce((acumulado, item) => acumulado + item.amount_cents, 0);

      return {
        currency: moeda,
        gross_cents,
        refunded_cents,
        net_cents: gross_cents - refunded_cents,
        sales_count: vendas_aprovadas.length,
        refunds_count: reembolsos.length,
      };
    });
  }

  getTotals(data_inicio: Date, data_fim: Date) {
    return this.obter_totais(data_inicio, data_fim);
  }

  obter_agrupados(data_inicio: Date, data_fim: Date, dimensao_agrupamento: 'day' | 'product' | 'platform'): any[] {
    const eventos_filtrados = this.eventos.filter(
      (evento) => evento.event_created_at >= data_inicio && evento.event_created_at <= data_fim
    );

    const mapa_grupos = new Map<string, { group_key: string; group_name?: string; currency: string; items: SaleEventRow[] }>();

    for (const item of eventos_filtrados) {
      let chave_grupo = '';
      let nome_grupo: string | undefined;

      if (dimensao_agrupamento === 'day') {
        chave_grupo = item.event_created_at.toISOString().slice(0, 10);
      } else if (dimensao_agrupamento === 'product') {
        chave_grupo = item.product_id;
        nome_grupo = item.product_name;
      } else if (dimensao_agrupamento === 'platform') {
        chave_grupo = item.platform;
      }

      const chave_mapa = `${chave_grupo}_${item.currency}`;
      if (!mapa_grupos.has(chave_mapa)) {
        mapa_grupos.set(chave_mapa, { group_key: chave_grupo, group_name: nome_grupo, currency: item.currency, items: [] });
      }
      mapa_grupos.get(chave_mapa)!.items.push(item);
    }

    const resultados: any[] = [];
    for (const grupo of mapa_grupos.values()) {
      const vendas_aprovadas = grupo.items.filter((evento) => evento.event_type === 'approved');
      const reembolsos = grupo.items.filter((evento) => evento.event_type === 'refunded');

      const gross_cents = vendas_aprovadas.reduce((acumulado, item) => acumulado + item.amount_cents, 0);
      const refunded_cents = reembolsos.reduce((acumulado, item) => acumulado + item.amount_cents, 0);

      resultados.push({
        group_key: grupo.group_key,
        group_name: grupo.group_name,
        currency: grupo.currency,
        gross_cents,
        refunded_cents,
        net_cents: gross_cents - refunded_cents,
        sales_count: vendas_aprovadas.length,
        refunds_count: reembolsos.length,
      });
    }

    return resultados;
  }

  getGrouped(data_inicio: Date, data_fim: Date, dimensao_agrupamento: 'day' | 'product' | 'platform') {
    return this.obter_agrupados(data_inicio, data_fim, dimensao_agrupamento);
  }
}

export const memoryDb = new BancoEmMemoria();
