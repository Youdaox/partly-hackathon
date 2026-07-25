"""rego -> vehicle slug, standing in for a real VIN lookup service.

Twelve registrations. Eight resolve to a slug under data/vehicles or
data/predictions; four are make-plate only, have no OEM catalogue, and exist to
exercise the `no_catalogue` path (spec 6.2) which is a success case, not an error.

Only three of the eight actually ship an assemblies.json in this dataset
(yaris, santafe, epace) — the other five resolve and have an Interpreter
prediction but no catalogue to index. Those three are ALLOWED_REGOS, and they
are the only ones `/vehicle/register` accepts; the map keeps the rest so the
resolver still has something to say about a plate it recognises.
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

# The registrations a case may actually be opened against: the three that ship a
# full OEM catalogue *and* an Interpreter prediction. The other nine resolve to
# a make and model but have nothing to propagate over, and a hidden-damage
# report with no catalogue behind it is worse than a clear refusal — it looks
# like an answer. Registration rejects them by name (spec 6.2 / rego_not_allowed).
ALLOWED_REGOS: tuple[str, ...] = ("QMN16", "PNS53", "RFH447")

# Simulated VIN resolution latency (spec 4.2: 800-5000 ms). Kept short enough
# that a demo does not stall; the client shows progress either way.
RESOLVE_MS_MIN = 800
RESOLVE_MS_MAX = 2600


def normalise(rego: str) -> str:
    return "".join(ch for ch in rego.upper() if ch.isalnum())


def allowed_vehicles() -> list[dict]:
    """The three permitted vehicles, for the picker the client renders."""
    vehicles = []
    for rego in ALLOWED_REGOS:
        slug, make, model, year, _vin = REGO_MAP[rego]
        vehicles.append(
            {"rego": rego, "make": make, "model": model, "year": year, "slug": slug}
        )
    return vehicles


def allowed_summary() -> str:
    """"QMN16 (Toyota Yaris), PNS53 (...), RFH447 (...)" — for the error text."""
    return ", ".join(
        f"{v['rego']} ({v['make']} {v['model']})" for v in allowed_vehicles()
    )
