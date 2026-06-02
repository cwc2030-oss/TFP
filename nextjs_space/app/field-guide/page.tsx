import type { Metadata } from 'next';
import Navbar from '@/components/navbar';

export const metadata: Metadata = {
  title: 'The Unwritten Rules of Rural Land — Terra Firma Partners',
  description:
    'A Missouri Field Guide to Neighboring Well. Your deed says what you own. This page tells you how to live on it.',
};

export default function FieldGuidePage() {
  return (
    <div className="min-h-screen bg-[#faf8f3]">
      <Navbar />

      <main className="max-w-5xl mx-auto px-4 sm:px-6 pt-28 sm:pt-36 pb-20 sm:pb-28">
        {/* Title block */}
        <header className="max-w-3xl mb-14">
          <h1 className="font-serif text-3xl sm:text-4xl lg:text-5xl font-bold text-stone-800 leading-tight">
            The Unwritten Rules of Rural Land
          </h1>
          <p className="font-serif text-xl sm:text-2xl text-stone-600 mt-3 italic">
            A Missouri Field Guide to Neighboring Well
          </p>
          <p className="mt-6 text-lg text-stone-700 leading-relaxed max-w-2xl">
            <strong>Your deed says what you own. This page tells you how to live on it.</strong>
          </p>
          <p className="mt-4 text-stone-600 leading-relaxed max-w-2xl">
            Rural land runs on an operating system nobody writes down. The families who&apos;ve been here for generations absorbed it growing up. If you&apos;re new to the country — welcome. Here&apos;s what they know.
          </p>
        </header>

        {/* Two-column grid on desktop, single column mobile */}
        <div className="columns-1 md:columns-2 gap-10 lg:gap-14 space-y-10">

          {/* Fences & Boundaries */}
          <Section title="Fences &amp; Boundaries">
            <Rule bold="The fence ain't always the line.">
              Old fences follow working history, not surveys. Your neighbor&apos;s daddy might&apos;ve set that post in 1962 based on a handshake. Don&apos;t move it without a conversation.
            </Rule>
            <Rule bold="Leave buffers alone.">
              That scrubby tree line between properties? It&apos;s there on purpose. Don&apos;t clear to the edge unless you&apos;ve talked first.
            </Rule>
            <Rule bold="If you didn't build it, don't fix it">
              — at least not without asking. That saggy gate has worked for 40 years.
            </Rule>
          </Section>

          {/* Gates & Crossings */}
          <Section title="Gates &amp; Crossings">
            <Rule bold="Leave gates how you found 'em.">
              Open means open. Closed means closed. There&apos;s livestock logic behind it.
            </Rule>
            <Rule bold="Paths exist.">
              Worn trails, creek crossings, two-tracks — some have been used for decades. Ask around before you block them.
            </Rule>
          </Section>

          {/* Noise, Activity & Seasons */}
          <Section title="Noise, Activity &amp; Seasons">
            <Rule bold="Rural ain't quiet.">
              Tractors at dawn. Chainsaws on Saturdays. Dogs barking at deer. Roosters. This is the soundtrack — not a disturbance.
            </Rule>
            <Rule bold="Hunting season is real.">
              Trucks at 4am in November? Turkey hunters in April? That&apos;s tradition. If you didn&apos;t post it and they&apos;ve hunted for years, expect a conversation before you shut it down.
            </Rule>
            <Rule bold="Hay gets cut when hay's ready.">
              Equipment at 10pm in June isn&apos;t rude — that&apos;s rain coming tomorrow.
            </Rule>
            <Rule bold="Controlled burns in March.">
              Smoke across the ridge? Don&apos;t call 911 unless someone&apos;s running.
            </Rule>
          </Section>

          {/* Wildlife & Water */}
          <Section title="Wildlife &amp; Water">
            <Rule bold="Deer don't read deeds.">
              Wildlife crosses every line. So do hunters&apos; eyes. Be a good neighbor about sight lines and food plots.
            </Rule>
            <Rule bold="Creeks are shared.">
              That drainage ditch or pond overflow doesn&apos;t belong to anybody fully. Don&apos;t dam it. Don&apos;t poison it. Don&apos;t assume.
            </Rule>
            <Rule bold="Predators happen.">
              Coyotes. Hawks. The occasional bold cat. Your neighbors have been managing this longer — ask before you escalate.
            </Rule>
          </Section>

          {/* The Neighbor Code */}
          <Section title="The Neighbor Code">
            <Rule bold="Wave.">
              Every time. Even if you don&apos;t know &apos;em yet.
            </Rule>
            <Rule bold="Assume good intent.">
              That guy on your line with a chainsaw? Probably cleaning up a tree that&apos;s half on his side. Say thanks before you say &ldquo;hey.&rdquo;
            </Rule>
            <Rule bold="Talk before you change things.">
              New fence, driveway, buildings, or noise? If it&apos;s visible from their porch, a heads-up goes a long way.
            </Rule>
            <Rule bold={'Don\'t be the one who "lawyered up."'}>
              You can win a boundary dispute and lose every neighbor for a mile. Out here, reputation lasts longer than lawsuits.
            </Rule>
          </Section>

          {/* The Bottom Line */}
          <Section title="The Bottom Line">
            <p className="text-stone-700 leading-relaxed">
              <strong>These aren&apos;t rules. They&apos;re how it works.</strong> Pay attention, ask questions, don&apos;t assume your deed makes you king — you&apos;ll fit in fine.
            </p>
            <p className="text-stone-700 leading-relaxed mt-3">
              <strong>And if you mess up?</strong> A six-pack and an apology go further than you&apos;d think.
            </p>
          </Section>

        </div>

        {/* Footer disclaimer */}
        <footer className="mt-16 pt-8 border-t border-stone-300/60 max-w-2xl">
          <p className="text-stone-500 text-sm italic">
            This isn&apos;t legal advice. It&apos;s land sense. Actual neighbor expectations vary — and that&apos;s the point.
          </p>
          <p className="text-stone-600 text-sm font-medium mt-4">
            Understanding land means understanding how it&apos;s been lived on. · TerraFirmaPartners.com
          </p>
        </footer>
      </main>
    </div>
  );
}

/* ── Section wrapper ── */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="break-inside-avoid-column">
      <h2
        className="font-serif text-xl sm:text-2xl font-bold text-stone-800 mb-4"
        dangerouslySetInnerHTML={{ __html: title }}
      />
      <div className="space-y-4">
        {children}
      </div>
    </div>
  );
}

/* ── Individual rule block ── */
function Rule({ bold, children }: { bold: string; children: React.ReactNode }) {
  return (
    <p className="text-stone-700 leading-relaxed">
      <strong className="text-stone-800">{bold}</strong>{' '}
      {children}
    </p>
  );
}
