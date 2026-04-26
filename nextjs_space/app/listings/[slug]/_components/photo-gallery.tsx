/**
 * Lazy-loaded photo gallery. Up to 6 photos. Lead photo is large, the rest
 * are square thumbnails in a 3-column grid below it.
 */
import Image from 'next/image';

export default function PhotoGallery({
  photos,
  title,
}: {
  photos: string[];
  title: string;
}) {
  if (!photos || photos.length === 0) return null;
  const [hero, ...rest] = photos.slice(0, 6);
  return (
    <section className="space-y-3">
      <div className="relative aspect-[16/10] sm:aspect-[16/9] rounded-xl overflow-hidden bg-stone-950 border border-stone-800">
        <Image
          src={hero}
          alt={title}
          fill
          priority
          sizes="(max-width: 1024px) 100vw, 75vw"
          className="object-cover"
        />
      </div>
      {rest.length > 0 && (
        <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
          {rest.map((src, i) => (
            <div
              key={src + i}
              className="relative aspect-square rounded-md overflow-hidden bg-stone-950 border border-stone-800"
            >
              <Image
                src={src}
                alt={`${title} — photo ${i + 2}`}
                fill
                loading="lazy"
                sizes="(max-width: 1024px) 33vw, 15vw"
                className="object-cover"
              />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
