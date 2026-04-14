const DEFAULT_MAX_STRING_LENGTH = 500;

const TRUNCATION_PREFIX = "\u00b7\u00b7\u00b7\uff08\u540e\u7eed\u8fd8\u6709";
const TRUNCATION_SUFFIX = "\u5b57\u8282\uff09";

function truncateString(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  const omittedText = value.slice(maxLength);
  const omittedBytes = new TextEncoder().encode(omittedText).length;

  return `${value.slice(0, maxLength)}${TRUNCATION_PREFIX}${omittedBytes}${TRUNCATION_SUFFIX}`;
}

function createPreviewValue(value: unknown, maxLength: number): unknown {
  if (typeof value === "string") {
    return truncateString(value, maxLength);
  }

  if (Array.isArray(value)) {
    return value.map((item) => createPreviewValue(item, maxLength));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, nestedValue]) => [
        key,
        createPreviewValue(nestedValue, maxLength),
      ]),
    );
  }

  return value;
}

export function createJsonPreview<T>(
  value: T,
  maxLength = DEFAULT_MAX_STRING_LENGTH,
): T {
  return createPreviewValue(value, maxLength) as T;
}

export function stringifyJsonPreview(
  value: unknown,
  maxLength = DEFAULT_MAX_STRING_LENGTH,
): string {
  return JSON.stringify(createJsonPreview(value, maxLength), null, 2);
}
