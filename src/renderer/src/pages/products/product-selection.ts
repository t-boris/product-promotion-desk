// Which product the Products page has open. Pure, so the rule is tested without the interface (BUG-042).

/**
 * The open product, from the route. A product in the list is open. A product the owner just created is open too, even before the
 * list has reloaded and holds it: `ProductDetail` loads by id, and a null selection would send the "a product is always open"
 * effect to an older product and replace the route (BUG-042, BUG-068, BUG-069). Any other id, such as a deleted product, selects nothing.
 */
export function resolveSelected(ids: readonly string[], routeId: string | null, createdId: string | null): string | null {
  if (routeId === null) return null
  if (ids.includes(routeId)) return routeId
  return routeId === createdId ? routeId : null
}
