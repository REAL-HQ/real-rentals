const gigLogoMap: Record<string, string> = {
  Uber: "https://upload.wikimedia.org/wikipedia/commons/5/58/Uber_logo_2018.svg",
  Lyft: "https://upload.wikimedia.org/wikipedia/commons/a/a0/Lyft_logo.svg",
  DoorDash: "https://upload.wikimedia.org/wikipedia/commons/6/6a/DoorDash_Logo.svg",
  Instacart: "https://upload.wikimedia.org/wikipedia/commons/9/9f/Instacart_logo_and_wordmark.svg",
  "Amazon Flex": "https://upload.wikimedia.org/wikipedia/commons/a/a9/Amazon_logo.svg",
  UberEats: "https://upload.wikimedia.org/wikipedia/commons/b/b3/Uber_Eats_2020_logo.svg",
  Grubhub: "https://upload.wikimedia.org/wikipedia/commons/3/3d/GrubHub_Logo_2016.svg",
};

export function GigLogoMarquee({ items }: { items: string[] }) {
  const repeated = [...items, ...items, ...items, ...items];
  return (
    <div className="mt-5 overflow-hidden">
      <div className="flex w-max animate-marquee">
        {repeated.map((item, i) => {
          const logoUrl = gigLogoMap[item];
          return (
            <div key={`${item}-${i}`} className="flex shrink-0 items-center justify-center px-5 md:px-8">
              {logoUrl ? (
                <img
                  src={logoUrl}
                  alt={item}
                  className="h-7 md:h-10 w-auto object-contain opacity-80 hover:opacity-100 transition"
                  loading="lazy"
                />
              ) : (
                <span className="text-base md:text-xl font-semibold text-foreground">{item}</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}