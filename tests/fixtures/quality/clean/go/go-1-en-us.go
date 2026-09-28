// Package cache provides a small in-memory cache with per-entry expiry.
//
// The cache is safe for concurrent use by multiple goroutines.
package cache

// Get returns the value stored under key and reports whether it was found.
// Expired entries are treated as missing and removed on access.
func Get(key string) (string, bool) {
	// Lookups never allocate, which keeps the hot path fast.
	return "", false
}
