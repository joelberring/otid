export function isStrictCoursePrefix(current: readonly number[], proposed: readonly number[]): boolean {
  return proposed.length > 0 && proposed.length < current.length &&
    proposed.every((code, index) => code === current[index]);
}
