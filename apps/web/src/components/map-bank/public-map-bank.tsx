"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { PublicMapAccessMode, PublicMapListingDetail, PublicMapListingSummary, PublicMapNorm } from "@o-tid/contracts";
import { countyByCode, municipalityByCode, searchMunicipalities, SWEDEN_COUNTIES, SWEDEN_MUNICIPALITIES } from "@o-tid/domain";
import { mapBankEn } from "../../i18n/map-bank-en";
import { mapBankSv } from "../../i18n/map-bank-sv";
import { useTexts } from "../language-provider";
import { Button, Notice } from "../ui";
import { OsmCatalogMap, type OsmBounds, type OsmMapFeature, type OsmMapFeatureTone } from "../ui/osm-map";
import { PublicMapBankDetail } from "./public-map-bank-detail";
import styles from "./public-map-bank.module.css";

interface CatalogListResponse {
  readonly formatVersion: 1;
  readonly items: readonly PublicMapListingSummary[];
  readonly total: number;
  readonly municipalityCounts: Readonly<Record<string, number>>;
}

export interface PublicMapBankProps {
  /** Valfria startdata för tester eller serverrendering. */
  readonly initialItems?: readonly PublicMapListingSummary[];
  readonly initialTotal?: number;
  readonly initialMunicipalityCounts?: Readonly<Record<string, number>>;
  readonly initialSelectedDetail?: PublicMapListingDetail | null;
}

function toneForAccessMode(mode: PublicMapAccessMode): OsmMapFeatureTone {
  if (mode === "OPEN_DOWNLOAD") return "open";
  if (mode === "USE_IN_OTID_LOCKED") return "otid";
  return "info";
}

function formatScale(scale: number): string {
  return `1:${scale.toString().replace(/\B(?=(\d{3})+(?!\d))/g, "\u00A0")}`;
}

/**
 * Publik sökbar kartbank (`/kartbank`): delad vy på dator (>= 900 px) med `OsmCatalogMap` + synkad lista och
 * detaljkort, och `Karta | Lista`-växlare med hopfällbara filter på 390 px mobil.
 */
export function PublicMapBank({
  initialItems,
  initialTotal,
  initialMunicipalityCounts,
  initialSelectedDetail = null
}: PublicMapBankProps = {}) {
  const text = useTexts(mapBankSv, mapBankEn);
  const [items, setItems] = useState<readonly PublicMapListingSummary[]>(initialItems ?? []);
  const [total, setTotal] = useState<number>(initialTotal ?? initialItems?.length ?? 0);
  const [municipalityCounts, setMunicipalityCounts] = useState<Readonly<Record<string, number>>>(initialMunicipalityCounts ?? {});
  const [loading, setLoading] = useState(initialItems === undefined);
  const [error, setError] = useState<string>();

  const [query, setQuery] = useState("");
  const [municipality, setMunicipality] = useState("");
  const [municipalityInput, setMunicipalityInput] = useState("");
  const [municipalityOpen, setMunicipalityOpen] = useState(false);
  const [county, setCounty] = useState("");
  const [norm, setNorm] = useState<"" | PublicMapNorm>("");
  const [accessMode, setAccessMode] = useState<"" | PublicMapAccessMode>("");
  const [bbox, setBbox] = useState<OsmBounds | null>(null);
  const [focusBounds, setFocusBounds] = useState<OsmBounds | null>(null);

  const [selectedId, setSelectedId] = useState<string | undefined>(initialSelectedDetail?.id);
  const [hoveredId, setHoveredId] = useState<string | undefined>();
  const [detail, setDetail] = useState<PublicMapListingDetail | null>(initialSelectedDetail);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string>();

  const [mobileView, setMobileView] = useState<"map" | "list">("map");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const blurTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const skipFirstFetchRef = useRef(initialItems !== undefined);

  const activeFilterCount =
    (query.trim() ? 1 : 0) +
    (municipality ? 1 : 0) +
    (county ? 1 : 0) +
    (norm ? 1 : 0) +
    (accessMode ? 1 : 0) +
    (bbox ? 1 : 0);

  useEffect(() => {
    if (skipFirstFetchRef.current) {
      skipFirstFetchRef.current = false;
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      const params = new URLSearchParams();
      if (query.trim()) params.set("q", query.trim());
      if (municipality) params.set("municipality", municipality);
      if (county) params.set("county", county);
      if (norm) params.set("norm", norm);
      if (accessMode) params.set("accessMode", accessMode);
      if (bbox) {
        params.set("minLon", bbox.minLon.toFixed(5));
        params.set("minLat", bbox.minLat.toFixed(5));
        params.set("maxLon", bbox.maxLon.toFixed(5));
        params.set("maxLat", bbox.maxLat.toFixed(5));
      }
      setLoading(true);
      setError(undefined);
      fetch(`/api/public/map-bank?${params.toString()}`, { signal: controller.signal, cache: "no-store" })
        .then(async response => {
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const data = (await response.json()) as CatalogListResponse;
          setItems(data.items ?? []);
          setTotal(data.total ?? 0);
          if (data.municipalityCounts) setMunicipalityCounts(data.municipalityCounts);
        })
        .catch((err: unknown) => {
          if (controller.signal.aborted) return;
          console.error("Kunde inte hämta kartbanken", err);
          setError(text.loadError);
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, query ? 200 : 0);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, municipality, county, norm, accessMode, bbox, text.loadError]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      setDetailError(undefined);
      setDetailLoading(false);
      return;
    }
    if (detail?.id === selectedId) return;
    const controller = new AbortController();
    setDetailLoading(true);
    setDetailError(undefined);
    fetch(`/api/public/map-bank/${encodeURIComponent(selectedId)}`, { signal: controller.signal, cache: "no-store" })
      .then(async response => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = (await response.json()) as { listing: PublicMapListingDetail };
        setDetail(data.listing);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        console.error("Kunde inte hämta kartdetaljer", err);
        setDetailError(text.detail.loadError);
        setDetail(null);
      })
      .finally(() => {
        if (!controller.signal.aborted) setDetailLoading(false);
      });
    return () => controller.abort();
  }, [selectedId, detail?.id, text.detail.loadError]);

  const mapFeatures = useMemo<readonly OsmMapFeature[]>(
    () =>
      items
        .filter(item => item.minLon !== null && item.minLat !== null && item.maxLon !== null && item.maxLat !== null)
        .map(item => ({
          id: item.id,
          title: item.title,
          minLon: item.minLon!,
          minLat: item.minLat!,
          maxLon: item.maxLon!,
          maxLat: item.maxLat!,
          ...(item.footprint ? { footprint: item.footprint } : {}),
          tone: toneForAccessMode(item.accessMode)
        })),
    [items]
  );

  const municipalityOptions = useMemo(() => {
    const trimmed = municipalityInput.trim();
    const base = trimmed ? searchMunicipalities(trimmed, 40) : [...SWEDEN_MUNICIPALITIES];
    return [...base].sort((a, b) => {
      const ca = municipalityCounts[a.code] ?? 0;
      const cb = municipalityCounts[b.code] ?? 0;
      if ((cb > 0) !== (ca > 0)) return cb > 0 ? 1 : -1;
      if (cb !== ca) return cb - ca;
      return a.name.localeCompare(b.name, "sv");
    });
  }, [municipalityInput, municipalityCounts]);

  function selectMunicipality(code: string) {
    setMunicipality(code);
    setMunicipalityOpen(false);
    setBbox(null);
    if (!code) {
      setMunicipalityInput("");
      return;
    }
    const found = municipalityByCode(code);
    if (found) {
      setMunicipalityInput(found.name);
      setCounty("");
      setFocusBounds(found.bounds);
    }
  }

  function selectCounty(code: string) {
    setCounty(code);
    setMunicipality("");
    setMunicipalityInput("");
    setBbox(null);
    if (code) {
      const found = countyByCode(code);
      if (found) setFocusBounds(found.bounds);
    }
  }

  function clearFilters() {
    setQuery("");
    setMunicipality("");
    setMunicipalityInput("");
    setCounty("");
    setNorm("");
    setAccessMode("");
    setBbox(null);
  }

  function handleSelectListing(id: string) {
    setSelectedId(id);
    setMobileView("list");
    const found = items.find(item => item.id === id);
    if (found && found.minLon !== null && found.minLat !== null && found.maxLon !== null && found.maxLat !== null) {
      setFocusBounds({ minLon: found.minLon, minLat: found.minLat, maxLon: found.maxLon, maxLat: found.maxLat });
    }
  }

  return (
    <main className={styles.page} data-testid="public-map-bank">
      <header className={styles.header}>
        <p className={styles.kicker}>{text.kicker}</p>
        <h1>{text.title}</h1>
        <p className={styles.intro}>{text.intro}</p>
      </header>

      <section className={styles.filterBar} aria-label={text.filtersTitle}>
        <div className={styles.mobileToolbar}>
          <div className={styles.switcher} role="group" aria-label={text.viewModeLabel}>
            <button
              type="button"
              className={styles.switchButton}
              aria-pressed={mobileView === "map"}
              onClick={() => setMobileView("map")}
            >
              {text.viewMap}
            </button>
            <button
              type="button"
              className={styles.switchButton}
              aria-pressed={mobileView === "list"}
              onClick={() => setMobileView("list")}
            >
              {text.viewList} ({total})
            </button>
          </div>
          <button
            type="button"
            className={styles.filterToggle}
            aria-expanded={filtersOpen}
            onClick={() => setFiltersOpen(open => !open)}
          >
            {text.filtersToggle(activeFilterCount)}
          </button>
        </div>

        <div className={filtersOpen ? styles.filtersGrid : `${styles.filtersGrid} ${styles.filtersCollapsed}`}>
          <div className={styles.filterField}>
            <label htmlFor="map-bank-search">{text.searchLabel}</label>
            <input
              id="map-bank-search"
              type="search"
              value={query}
              placeholder={text.searchPlaceholder}
              onChange={event => setQuery(event.target.value)}
            />
          </div>

          <div className={`${styles.filterField} ${styles.municipalityCombo}`}>
            <label htmlFor="map-bank-municipality">{text.municipalityLabel}</label>
            <input
              id="map-bank-municipality"
              type="search"
              value={municipalityInput}
              placeholder={text.municipalitySearchPlaceholder}
              autoComplete="off"
              aria-expanded={municipalityOpen}
              onFocus={() => {
                if (blurTimerRef.current) clearTimeout(blurTimerRef.current);
                setMunicipalityOpen(true);
              }}
              onBlur={() => {
                blurTimerRef.current = setTimeout(() => setMunicipalityOpen(false), 150);
              }}
              onChange={event => {
                const next = event.target.value;
                setMunicipalityInput(next);
                setMunicipalityOpen(true);
                if (!next.trim() && municipality) setMunicipality("");
              }}
            />
            {municipalityOpen && (
              <div className={styles.municipalityDropdown} role="listbox" aria-label={text.municipalityLabel}>
                <button
                  type="button"
                  role="option"
                  aria-selected={municipality === ""}
                  data-selected={municipality === "" ? "true" : undefined}
                  className={styles.municipalityOption}
                  onMouseDown={event => event.preventDefault()}
                  onClick={() => selectMunicipality("")}
                >
                  <span>{text.municipalityAll}</span>
                </button>
                {municipalityOptions.slice(0, 50).map(item => {
                  const count = municipalityCounts[item.code] ?? 0;
                  return (
                    <button
                      key={item.code}
                      type="button"
                      role="option"
                      aria-selected={municipality === item.code}
                      data-selected={municipality === item.code ? "true" : undefined}
                      className={styles.municipalityOption}
                      onMouseDown={event => event.preventDefault()}
                      onClick={() => selectMunicipality(item.code)}
                    >
                      <span>{item.name}</span>
                      {count > 0 ? (
                        <span className={styles.municipalityCount} aria-label={text.mapCountInMunicipality(count)}>
                          {count}
                        </span>
                      ) : (
                        <span className={styles.municipalityMeta}>{item.countyName}</span>
                      )}
                    </button>
                  );
                })}
                {municipalityOptions.length === 0 && <p className={styles.municipalityMeta}>{text.municipalityEmpty}</p>}
              </div>
            )}
          </div>

          <div className={styles.filterField}>
            <label htmlFor="map-bank-county">{text.countyLabel}</label>
            <select id="map-bank-county" value={county} onChange={event => selectCounty(event.target.value)}>
              <option value="">{text.countyAll}</option>
              {SWEDEN_COUNTIES.map(item => (
                <option key={item.code} value={item.code}>{item.name}</option>
              ))}
            </select>
          </div>

          <div className={styles.filterField}>
            <label htmlFor="map-bank-norm">{text.normLabel}</label>
            <select id="map-bank-norm" value={norm} onChange={event => setNorm(event.target.value as "" | PublicMapNorm)}>
              <option value="">{text.normAll}</option>
              <option value="ISOM">{text.norms.ISOM}</option>
              <option value="ISSprOM">{text.norms.ISSprOM}</option>
              <option value="OTHER">{text.norms.OTHER}</option>
            </select>
          </div>

          <div className={styles.filterField}>
            <label htmlFor="map-bank-access">{text.accessLabel}</label>
            <select id="map-bank-access" value={accessMode} onChange={event => setAccessMode(event.target.value as "" | PublicMapAccessMode)}>
              <option value="">{text.accessAll}</option>
              <option value="OPEN_DOWNLOAD">{text.accessModes.OPEN_DOWNLOAD}</option>
              <option value="USE_IN_OTID_LOCKED">{text.accessModes.USE_IN_OTID_LOCKED}</option>
              <option value="INFO_ONLY">{text.accessModes.INFO_ONLY}</option>
            </select>
          </div>

          {activeFilterCount > 0 && (
            <Button variant="secondary" className={styles.clearButton} onClick={clearFilters}>
              {text.clearFilters}
            </Button>
          )}
        </div>

        {bbox && (
          <div className={styles.activeBboxBar} role="status">
            <span>{text.bboxActive}</span>
            <Button variant="secondary" onClick={() => setBbox(null)}>{text.clearBbox}</Button>
          </div>
        )}
      </section>

      {error && <Notice tone="error" role="alert">{error}</Notice>}

      <div className={styles.split}>
        <section className={mobileView === "map" ? styles.mapPane : `${styles.mapPane} ${styles.paneHidden}`}>
          <OsmCatalogMap
            features={mapFeatures}
            {...(selectedId ? { selectedId } : {})}
            {...(hoveredId ? { hoveredId } : {})}
            focusBounds={focusBounds}
            {...(styles.mapCanvas ? { className: styles.mapCanvas } : {})}
            onSelect={handleSelectListing}
            onHover={setHoveredId}
            onBoundsChange={nextBounds => setBbox(nextBounds)}
          />
          <div className={styles.legend} aria-label={text.legendLabel}>
            <span className={styles.legendItem}>
              <span className={styles.legendSwatch} data-tone="open" aria-hidden="true" />
              {text.accessModes.OPEN_DOWNLOAD}
            </span>
            <span className={styles.legendItem}>
              <span className={styles.legendSwatch} data-tone="otid" aria-hidden="true" />
              {text.accessModes.USE_IN_OTID_LOCKED}
            </span>
            <span className={styles.legendItem}>
              <span className={styles.legendSwatch} data-tone="info" aria-hidden="true" />
              {text.accessModes.INFO_ONLY}
            </span>
          </div>
        </section>

        <section
          className={mobileView === "list" ? styles.listPane : `${styles.listPane} ${styles.paneHidden}`}
          aria-label={text.listHeading}
        >
          {selectedId && (
            <PublicMapBankDetail
              listing={detail}
              loading={detailLoading}
              {...(detailError ? { error: detailError } : {})}
              onClose={() => setSelectedId(undefined)}
            />
          )}

          <div className={styles.listMeta} role="status" aria-live="polite">
            <span>{loading ? text.loading : text.resultCount(items.length, total)}</span>
          </div>

          {!loading && items.length === 0 ? (
            <div className={styles.emptyState} data-testid="map-bank-empty">
              <h2>{text.emptyTitle}</h2>
              <p className={styles.intro}>{text.emptyHelp}</p>
            </div>
          ) : (
            <ul className={styles.list} data-testid="map-bank-list">
              {items.map(item => {
                const munis = item.municipalityCodes
                  .map(code => municipalityByCode(code)?.name ?? code)
                  .join(", ");
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      className={styles.cardButton}
                      data-selected={selectedId === item.id ? "true" : undefined}
                      data-hovered={hoveredId === item.id ? "true" : undefined}
                      aria-pressed={selectedId === item.id}
                      onClick={() => handleSelectListing(item.id)}
                      onMouseEnter={() => setHoveredId(item.id)}
                      onMouseLeave={() => setHoveredId(undefined)}
                    >
                      <div className={styles.cardHead}>
                        <span className={styles.cardTitle}>{item.title}</span>
                        <span className={styles.badge} data-mode={item.accessMode}>
                          {text.accessModes[item.accessMode]}
                        </span>
                      </div>
                      <div className={styles.cardMeta}>
                        {item.clubName && <span>{item.clubName}</span>}
                        {munis && <span>{munis}</span>}
                        {item.scale && <span>{formatScale(item.scale)}</span>}
                        <span>{text.norms[item.norm]}</span>
                        {item.mapYear && <span>{item.mapYear}</span>}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}
