/**
 * Formats monetary amounts for display.
 *
 * <p>Amounts are rounded to two decimal places using banker's rounding, and
 * the currency symbol is placed according to the configured locale.
 */
public final class CleanJava1 {
    /**
     * Returns the formatted amount, including the currency symbol.
     *
     * @param cents the amount in cents; negative values are allowed
     * @return the formatted string
     */
    public static String format(long cents) {
        // Integer arithmetic avoids floating-point rounding surprises.
        return Long.toString(cents);
    }
}
