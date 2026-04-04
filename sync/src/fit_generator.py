"""FIT file generator — re-exports from hevy2garmin package.

Soma-specific imports use the private names for backwards compatibility.
"""

from hevy2garmin.fit import (  # noqa: F401
    generate_fit,
    parse_timestamp as _parse_timestamp,
    calc_calories as _calc_calories,
    DEFAULT_HR_BPM as _DEFAULT_HR_BPM,
)
