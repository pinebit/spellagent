// Package safety contains résumé 😀 prose.
package safety

/*
#cgo CFLAGS: -DVALUE=1
#include <stdlib.h>
*/
import "C"

//go:generate echo protected
//go:embed fixture.txt
var fixture string

// Eligible comment prose.
func Example() {}
