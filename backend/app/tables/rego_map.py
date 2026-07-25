"""rego -> vehicle slug, standing in for a real VIN lookup service.

Twelve registrations. Eight resolve to a slug under data/vehicles or
data/predictions; four are make-plate only, have no OEM catalogue, and exist to
exercise the `no_catalogue` path (spec 6.2) which is a success case, not an error.

Only three of the eight actually ship an assemblies.json in this dataset
(yaris, santafe, epace) — the other five resolve and have an Interpreter
prediction but no catalogue to index.
"""

# rego -> (slug | None, make, model, year, vin | None)
REGO_MAP: dict[str, tuple[str | None, str, str, int | None, str | None]] = {
    "QMN16": ("toyota-yaris-qmn16", "Toyota", "Yaris", 2023, "JTDKBAA3301006094"),
    "PNS53": ("hyundai-santafe-pns53", "Hyundai", "Santa Fe", 2022, "KMHS281HWPU455295"),
    "RFH447": ("jaguar-epace-rfh447", "Jaguar", "E-Pace", 2018, "SADFA2AX7J1Z13028"),
    "EZU765": ("hyundai-iload-ezu765", "Hyundai", "iLoad", 2019, None),
    "RLP440": ("mitsubishi-outlander-rlp440", "Mitsubishi", "Outlander", 2021, None),
    "RFT360": ("nissan-silvia-rft360", "Nissan", "Silvia", 1999, None),
    "NYE733": ("toyota-hiace-nye733", "Toyota", "HiAce", 2020, None),
    "PKW74": ("toyota-prius-pkw74", "Toyota", "Prius", 2016, None),
    # Make-plate only: no catalogue, no Interpreter output.
    "NUE975": (None, "Holden", "Barina", 2013, None),
    "JZU83": (None, "Nissan", "Juke", 2014, None),
    "PBU474": (None, "Renault", "Unknown", None, None),
    "NNS414": (None, "Suzuki", "Unknown", None, None),
}

# Simulated VIN resolution latency (spec 4.2: 800-5000 ms). Kept short enough
# that a demo does not stall; the client shows progress either way.
RESOLVE_MS_MIN = 800
RESOLVE_MS_MAX = 2600


def normalise(rego: str) -> str:
    return "".join(ch for ch in rego.upper() if ch.isalnum())
