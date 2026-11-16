export const getActiveControllerIndex = (): number | undefined => {
  const host = window as unknown as {
    SteamUIStore?: { ActiveControllerIndex?: number; MostRecentlyActiveControllerIndex?: number };
  };
  const store = host.SteamUIStore;
  // Steam's device index is not its XInput slot: the built-in Deck controller can be 15.
  return [store?.ActiveControllerIndex, store?.MostRecentlyActiveControllerIndex].find(
    (index): index is number => Number.isInteger(index) && index! >= 0 && index! < 16,
  );
};
