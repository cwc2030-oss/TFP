/**
 * Step indicator for the 3-step wizard.
 * Highlights the active step; collapsed on small screens.
 */
export default function StepHeader({ currentStep }: { currentStep: 1 | 2 | 3 | 4 }) {
  const steps = [
    { n: 1, label: 'Pick property' },
    { n: 2, label: 'Lease terms' },
    { n: 3, label: 'Photos & contact' },
    { n: 4, label: 'Review & publish' },
  ];
  return (
    <nav aria-label="Wizard progress" className="flex items-center gap-2 text-sm">
      {steps.map((s, i) => {
        const active = s.n === currentStep;
        const done = s.n < currentStep;
        return (
          <div key={s.n} className="flex items-center gap-2">
            <span
              className={
                'inline-flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold ' +
                (active
                  ? 'bg-emerald-500 text-white'
                  : done
                    ? 'bg-emerald-700 text-emerald-100'
                    : 'bg-stone-700 text-stone-400')
              }
            >
              {s.n}
            </span>
            <span
              className={
                active
                  ? 'text-stone-100 font-medium'
                  : done
                    ? 'text-stone-400'
                    : 'text-stone-500'
              }
            >
              {s.label}
            </span>
            {i < steps.length - 1 && <span className="text-stone-700 px-1">→</span>}
          </div>
        );
      })}
    </nav>
  );
}
