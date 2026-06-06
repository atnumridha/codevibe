export interface ExtensionUriLike {
	toString(): string
}

export function getRawExtensionUriString(uri: ExtensionUriLike): string {
	return uri.toString()
}
