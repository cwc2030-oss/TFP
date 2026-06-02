import type { Metadata } from 'next';
import Image from 'next/image';
import Navbar from '@/components/navbar';

export const metadata: Metadata = {
  title: 'Our Story — Terra Firma Partners',
  description:
    'The story behind Terra Firma Partners — from a family hunting property in Johnson County to a hunting-intelligence platform for landowners and hunters.',
};

/* One-line config: swap when Clark sends the final photo */
const OUTHOUSE_IMAGE = '/outhouse.jpg';

export default function OurStoryPage() {
  return (
    <div className="min-h-screen bg-[#faf8f3]">
      <Navbar />

      <main className="max-w-[700px] mx-auto px-4 sm:px-6 pt-28 sm:pt-36 pb-20 sm:pb-28">
        <h1 className="font-serif text-3xl sm:text-4xl lg:text-5xl font-bold text-stone-800 mb-10 leading-tight">
          Our Story
        </h1>

        <div className="prose-story space-y-6 text-stone-700 text-lg leading-[1.85] font-normal">
          <p>
            My family bought this land when I was at Raytown South High in Kansas City. My dad Kelly had a vision: a place to retire and hunt, somewhere he could be himself outside the city.
          </p>

          <p>
            The first few years we only hunted the front. The back — a quarter mile wide, three quarters long — was so overgrown you couldn&apos;t walk it. The older hunters sent the younger ones to stir game out, and the rest of us waited for the deer to break.
          </p>

          <p>
            One night in the eighties, Dad and his hunting buddy Cliff decided to burn off what is now the Clover Field. The fire got bigger than they planned, then bigger than that. When they finally couldn&apos;t stop it, they drove into town to Perry Foster&apos;s Barbeque before heading back to the city. The Colwells made an impression on Leeton and Warrensburg. Being Kelly and Lucy&apos;s boy is something I still mention whenever I can.
          </p>

          <p>
            When I was seven, my dad worked a day job at Southwestern Bell in downtown KC. On weekends he and I would knock on the doors of farmhouses and ask if we could squirrel hunt. He called me Eagle Eye back then. We hunted dove and turkeys in the spring, deer in the fall.
          </p>

          <p>
            The oldest stand on the property is on the Clover Field. In retirement, my folks would carry cappuccino to the &ldquo;outhouse&rdquo; Dad built to hunt from. They would count deer in the evenings before season. Dad was my trail camera while I was still working in the city.
          </p>

          {/* Outhouse photo — inline between paragraphs */}
          <figure className="my-10">
            <div className="relative rounded-xl overflow-hidden shadow-lg" style={{ maxWidth: 600, margin: '0 auto' }}>
              <div className="relative aspect-square">
                <Image
                  src={OUTHOUSE_IMAGE}
                  alt="The 'outhouse' hunting blind at the edge of the Clover Field on C-Nile Acres"
                  fill
                  className="object-cover"
                  sizes="(max-width: 640px) 100vw, 600px"
                  priority
                />
              </div>
            </div>
            <figcaption className="text-center text-stone-500 text-sm mt-3 italic">
              The &ldquo;outhouse,&rdquo; at the edge of the Clover Field.
            </figcaption>
          </figure>

          <p>
            By fall the woods are loud — squirrels, turkeys, every critter stirring up the leaf litter. The smell of fall woods that tells you winter is coming. Dad blowing leaves off the campground as the family rolled in from a week of work. Friday night before opening morning, he&apos;d have a fire going and steaks on the open grill. Just family, plus my hunting buddy Dean, who&apos;d earned all rights and privileges. Primal energy. Locked and loaded by 5 AM.
          </p>

          <p>
            In forty years of hunting that ground, we never took a Boone &amp; Crockett buck. We hunted as hard as anyone. We knew the land. But the trophy never came, and we couldn&apos;t quite say why.
          </p>

          <p>
            The first time I ran our property — C-Nile Acres — through Terrain Brain, my heart was racing. There it was on the map: the deer flow skirts the property. Our 100 isn&apos;t a trophy destination — never was. It&apos;s a family meat-hunting property, a conservation property, the kind of place that fills freezers and teaches kids and grounds you when life gets loud. Terrain Brain showed me in five minutes what forty years had been quietly telling us.
          </p>

          <p>
            That&apos;s what TFP is for. Not turning every property into a trophy farm. Showing landowners and hunters what their land actually is, and matching the two honestly.
          </p>

          <p>
            My daughters have already paid the price for being Colwell girls — each got left in the forest after dark on a snipe hunt at least once. They forgave me. I want them, and their kids, to walk this ground forty years from now and find it functional, flourishing, accessible when they want it, left alone when they don&apos;t.
          </p>

          <p>
            Mostly I want to leave it better than I found it. That&apos;s the whole project.
          </p>

          <p className="font-serif text-stone-800 mt-12 text-xl">
            — Clark Colwell, Founder, Terra Firma Partners
          </p>
        </div>
      </main>
    </div>
  );
}
