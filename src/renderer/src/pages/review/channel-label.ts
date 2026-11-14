/**
 * How the Channel pop-up of Publications and Opportunities names a channel. Across all products the product comes first
 * ("Product · channel"); once a product is chosen, every channel of the list is already its own, so the pop-up shows the
 * channel alone, which is the only new information in it.
 */
export function channelLabel(productName: string | undefined, target: string, productChosen: boolean): string {
  return productName && !productChosen ? `${productName} · ${target}` : target
}
