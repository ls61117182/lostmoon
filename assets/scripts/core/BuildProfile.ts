/** Switch to 'development' to restore developer tools before previewing/building. */
export type BuildProfile = 'development' | 'demo';
export const BUILD_PROFILE: BuildProfile = 'development';

function isDemoProfile(profile: BuildProfile): boolean {
  return profile === 'demo';
}

const demo = isDemoProfile(BUILD_PROFILE);

export const BUILD_FEATURES = Object.freeze({
  tankVisualDebugger: !demo,
  playerTankSelection: !demo,
  testChapter: !demo,
  gameModeSelection: !demo,
  campaignDebugSkip: !demo,
});

/** Keep development saves intact and never resume them in the demo. */
export function profileStorageKey(key: string): string {
  return demo ? `${key}:demo` : key;
}
