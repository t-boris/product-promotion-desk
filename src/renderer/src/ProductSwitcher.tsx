import { useEffect, useRef, type KeyboardEvent } from 'react'
import { Icon } from './icons'
import { launchStages } from './pages/products/launch-path'
import { LaunchDots, useLaunchCounts } from './pages/products/LaunchPath'
import { productLabels } from './pages/products/product-labels'
import { useCurrentProduct } from './product-context'
import { NEW_PRODUCT_HREF } from './route'
import { usePopover } from './ui'
import './product-switcher.css'

const ITEMS = '[role="menuitemradio"], [role="menuitem"]'

/**
 * The product switcher at the head of the sidebar (DEC-037): the current product with its launch path as dots, and a pop-up with every
 * product and "New product". Every screen but Accounts, Log and Settings shows the product chosen here, so the sidebar is where the
 * owner always sees which one that is. Works from the keyboard: Down opens the list, Up and Down move through it, Escape closes it
 * and gives the focus back to the button.
 */
export function ProductSwitcher() {
  const { products, current, setCurrent, loading } = useCurrentProduct()
  const { countsOf } = useLaunchCounts()
  const { open, setOpen, box } = usePopover()
  const trigger = useRef<HTMLButtonElement>(null)
  const labels = productLabels(products)
  const stagesOf = (id: string, passportApproved: boolean, goals: number) => launchStages(id, { hasSources: true, passportApproved, goals, ...countsOf(id) })

  // Opening puts the focus in the list, on the current product.
  useEffect(() => {
    if (!open) return
    const items = box.current?.querySelectorAll<HTMLElement>(ITEMS)
    const chosen = box.current?.querySelector<HTMLElement>('[aria-checked="true"]')
    ;(chosen ?? items?.[0])?.focus()
  }, [open, box])

  const close = (): void => {
    setOpen(false)
    trigger.current?.focus()
  }

  const onListKey = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape') {
      event.stopPropagation()
      close()
      return
    }
    const step = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0
    if (step === 0 && event.key !== 'Home' && event.key !== 'End') return
    event.preventDefault()
    const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(ITEMS))
    const at = items.findIndex((item) => item === document.activeElement)
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (at + step + items.length) % items.length
    items[next]?.focus()
  }

  const currentStages = current ? stagesOf(current.id, current.activePassportVersionId !== null, current.goals.length) : null
  const currentLabel = current ? (labels.get(current.id) ?? current.name) : loading ? 'Loading…' : 'No product yet'

  return (
    <div className="switcher" ref={box}>
      <button
        ref={trigger}
        type="button"
        className="switcher-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Product: ${currentLabel}`}
        title={currentLabel}
        disabled={loading && !current}
        onClick={() => setOpen(!open)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' && !open) {
            event.preventDefault()
            setOpen(true)
          }
        }}
        data-testid="product-switcher"
      >
        <span className="switcher-name">{currentLabel}</span>
        {currentStages && <LaunchDots stages={currentStages} testId="product-switcher-dots" />}
        <Icon name="chevronUpDown" small />
      </button>
      {open && (
        <div className="switcher-pop" role="menu" aria-label="Products" onKeyDown={onListKey} data-testid="product-switcher-list">
          {products.map((product) => {
            const label = labels.get(product.id) ?? product.name
            const chosen = product.id === current?.id
            return (
              <button
                key={product.id}
                type="button"
                role="menuitemradio"
                aria-checked={chosen}
                className={`switcher-item${chosen ? ' on' : ''}`}
                title={label}
                onClick={() => {
                  setCurrent(product.id)
                  close()
                }}
                data-testid={`product-${product.id}`}
              >
                <span className="switcher-name">{label}</span>
                <LaunchDots stages={stagesOf(product.id, product.activePassportVersionId !== null, product.goals.length)} testId={`launch-dots-${product.id}`} />
              </button>
            )
          })}
          {products.length > 0 && <div className="switcher-sep" role="separator" />}
          <a className="switcher-item switcher-new" role="menuitem" href={NEW_PRODUCT_HREF} onClick={() => setOpen(false)} data-testid="new-product">
            <Icon name="plus" small />
            <span>New product</span>
          </a>
        </div>
      )}
    </div>
  )
}
