import { TIERS } from '../progress.js'

export default function OrderTrack({ states }) {
  return (
    <span className="order-track" aria-hidden="true">
      {states.map((state, index) => (
        <span
          className="order-track-seg"
          data-state={state}
          key={TIERS[index].key}
        />
      ))}
    </span>
  )
}
