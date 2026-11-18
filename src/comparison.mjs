export function present(state) {
  const quotes = Object.values(state.quotes).filter(quote => state.inquiries[quote.inquiry]);
  quotes.sort((left, right) => left.total - right.total || left.id.localeCompare(right.id));
  return { inquiries: Object.values(state.inquiries), quotes, cheapest: quotes[0]?.id ?? null };
}
