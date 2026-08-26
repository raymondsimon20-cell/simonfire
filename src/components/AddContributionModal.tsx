import { useState } from 'react'
import { Modal } from './Modal'
import { Button } from './ui'
import { useStore } from '../lib/store'

export function AddContributionModal({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const { data, addTransaction } = useStore()
  const [kind, setKind] = useState<'Contribution' | 'Withdrawal'>('Contribution')
  const [account, setAccount] = useState('')
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [desc, setDesc] = useState('')

  const reset = () => {
    setKind('Contribution')
    setAccount('')
    setAmount('')
    setDate(new Date().toISOString().slice(0, 10))
    setDesc('')
  }

  const submit = () => {
    const amt = parseFloat(amount)
    if (!account || !amt || amt <= 0) return
    addTransaction({
      accountId: account,
      date,
      type: kind,
      description: desc || (kind === 'Contribution' ? 'External contribution' : 'Withdrawal'),
      amount: kind === 'Contribution' ? amt : -amt,
      units: 0,
      tags: kind === 'Contribution' ? ['contribution'] : [],
    })
    reset()
    onClose()
  }

  return (
    <Modal
      open={open}
      onClose={() => {
        reset()
        onClose()
      }}
      title="Add Contribution"
      subtitle="Record an external deposit you made into one of your accounts."
      footer={
        <>
          <Button
            onClick={() => {
              reset()
              onClose()
            }}
          >
            Cancel
          </Button>
          <Button variant="primary" onClick={submit}>
            Add {kind}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <div>
          <label className="mb-2 block text-sm font-semibold">Transaction Type</label>
          <div className="grid grid-cols-2 gap-1 rounded-xl border border-[--color-border] bg-[--color-surface-2] p-1">
            {(['Contribution', 'Withdrawal'] as const).map((k) => (
              <button
                key={k}
                onClick={() => setKind(k)}
                className={`rounded-lg py-2 text-sm font-medium transition-colors ${
                  kind === k ? 'bg-[--color-brand] text-white' : 'text-[--color-muted]'
                }`}
              >
                {k}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="mb-2 block text-sm font-semibold">Account</label>
          <select
            value={account}
            onChange={(e) => setAccount(e.target.value)}
            className="w-full rounded-xl border border-[--color-border] bg-[--color-surface-2] px-3 py-2.5 text-sm outline-none focus:border-[--color-brand]"
          >
            <option value="">Select an account</option>
            {data.accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} ····{a.mask}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-2 block text-sm font-semibold">Amount</label>
          <div className="flex items-center rounded-xl border border-[--color-border] bg-[--color-surface-2] px-3 focus-within:border-[--color-brand]">
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))}
              placeholder="0.00"
              inputMode="decimal"
              className="num w-full bg-transparent py-2.5 text-sm outline-none"
            />
            <span className="text-sm text-[--color-faint]">USD</span>
          </div>
          <p className="mt-1 text-xs text-[--color-faint]">Up to $1,000,000 per entry.</p>
        </div>

        <div>
          <label className="mb-2 block text-sm font-semibold">Date</label>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-full rounded-xl border border-[--color-border] bg-[--color-surface-2] px-3 py-2.5 text-sm outline-none focus:border-[--color-brand] [color-scheme:dark]"
          />
        </div>

        <div>
          <label className="mb-2 block text-sm font-semibold">
            Description <span className="font-normal text-[--color-faint]">(optional)</span>
          </label>
          <textarea
            value={desc}
            maxLength={200}
            onChange={(e) => setDesc(e.target.value)}
            placeholder="e.g. April paycheck"
            rows={3}
            className="w-full resize-none rounded-xl border border-[--color-border] bg-[--color-surface-2] px-3 py-2.5 text-sm outline-none focus:border-[--color-brand]"
          />
          <div className="mt-1 text-right text-xs text-[--color-faint]">{desc.length}/200</div>
        </div>
      </div>
    </Modal>
  )
}
