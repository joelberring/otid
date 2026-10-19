"use client";

import styles from "../race-administrator-workspace.module.css";
import { raceAdministratorSv as text } from "../../i18n/race-administrator-sv";
import { formatClockTime, parseRaceClock } from "../../lib/clock-time";
import { TargetClassStartTimes } from "../target-class-start-times";
import { Button, Field, Notice } from "../ui";
import type { Workspace } from "./workspace-state";

/** Deltagaråtgärder: byt klass, bricka och hyrbricka, starttid och identitet. */
export function EntryActionForms({ ws }: { ws: Workspace }) {
  const { action, busy, cardAttempt, classId, data, disabled, familyName, givenName, identityAttempt,
    identityMatches, loadIdentity, newCard, organisationName,
    pending, prepareCard, prepareIdentity, prepareRental,
    prepareRentalReturn, prepareRentalReuse, prepareTime, prepareTransfer, rentalAttempt, rentalReturnAttempt,
    rentalReuseAttempt, rentalReuseSourceId, returnedRentalSources, selected, selectedClass,
    sent, setClassId, setFamilyName, setGivenName, setMessage, setNewCard, setOrganisationName, setRentalReuseSourceId,
    setStartClock, setTimeAttempt, setTransferAttempt, startClock, submitCard, submitIdentity, submitRental, submitRentalReturn,
    submitRentalReuse, submitTime, submitTransfer, target, targetFull, timeAttempt, transferAttempt, unknown } = ws;
  return <>
    {action === "TRANSFER" && <><h2>{text.changeClass}</h2>
    <p className={styles.warning}>{text.limitation}</p>
    {transferAttempt ? <div className={styles.review} role="alert"><h2>{text.review}</h2><p>{transferAttempt.displayName}</p>
      <p>{transferAttempt.previousClassName} → <strong>{transferAttempt.className}</strong></p><p>{text.resultImpact}</p>
      <p>{text.previousTime}: {transferAttempt.request.expectedFixedStartTime ? formatClockTime(transferAttempt.request.expectedFixedStartTime, data?.timeZone ?? "UTC") : text.noFixedTime}</p>
      <p>{text.startRule}: {transferAttempt.request.expectedTargetStartRule === "FIXED" ? text.fixed : text.punch}</p>
      <p>{text.newTime}: <strong>{transferAttempt.request.fixedStartTime ? formatClockTime(transferAttempt.request.fixedStartTime, data?.timeZone ?? "UTC") : text.noFixedTime}</strong></p>
      {unknown && <p>{text.unreachable}</p>}
      <button disabled={busy} onClick={() => void submitTransfer(transferAttempt)}>{unknown ? text.retry : text.confirm}</button>
      {!unknown && <button className="secondary" disabled={busy} onClick={() => { pending.current = undefined; sent.current = false; setTransferAttempt(undefined); }}>{text.cancel}</button>}
    </div> : selected ? <form className={styles.workspace} noValidate onSubmit={prepareTransfer}>
      <p>{text.previousTime}: {selected.fixedStartTime && data ? formatClockTime(selected.fixedStartTime, data.timeZone) : text.noFixedTime}</p>
      <label>{text.targetClass}<select value={classId} disabled={disabled} required onChange={(event) => {
        setClassId(event.target.value); setStartClock(""); setMessage("");
      }}>
        <option value="">{text.chooseClass}</option>{data?.classes.filter((row) => row.id !== selected.classId).map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
      </select></label>
      {target && <p>{text.startRule}: <strong>{target.startRule === "FIXED" ? text.fixed : text.punch}</strong></p>}
      {target && <p>{text.capacityCount}: {target.entryCount} / {target.maxEntries ?? text.unlimited} {targetFull && <strong>— {text.classFull}</strong>}</p>}
      {target?.startRule === "FIXED" && <>
        {data && <TargetClassStartTimes key={`${target.id}:${data.snapshotVersion}`} entries={data.entries} classId={target.id}
          timeZone={data.timeZone} proposedTime={parseRaceClock(data.raceDate, startClock, data.timeZone)} />}
        <div className={styles.timeFields}>
          <label>{text.startClock}<input type="text" inputMode="numeric" autoComplete="off" placeholder="18:30" value={startClock} required disabled={disabled}
            onChange={(event) => setStartClock(event.target.value)} /></label>
        </div>
        <p>{text.timeHelp}</p>
      </>}
      {target?.startRule === "PUNCH" && <p>{text.punchHelp}</p>}
      <p>{text.resultImpact}</p><button disabled={disabled || !classId || targetFull}>{text.inspect}</button>
    </form> : <p>{text.chooseEntry}</p>}</>}
    {action === "CARD" && <section className={styles.workspace} aria-label={text.cardTitle}>
      <h2>{text.cardTitle}</h2>
      {cardAttempt && unknown ? <div className={styles.review} role="alert"><h2>{text.cardReview}</h2>
        <p>{cardAttempt.displayName}</p>
        <p>{text.currentCard}: {cardAttempt.request.expectedAssignment?.cardNumber ?? text.noCard} → <strong>{cardAttempt.request.cardNumber}</strong></p>
        <p>{text.resultImpact}</p><p>{text.unreachable}</p>
        <button disabled={busy} onClick={() => void submitCard(cardAttempt)}>{text.retry}</button>
      </div> : rentalAttempt && unknown ? <div className={styles.review} role="alert"><h2>{text.rentalReview}</h2>
        <p>{rentalAttempt.displayName} · {rentalAttempt.request.expectedAssignment.cardNumber}</p>
        <p><strong>{rentalAttempt.request.isRental ? text.rentalMarkConsequence : text.rentalUnmarkConsequence}</strong></p>
        <p>{text.unreachable}</p>
        <button disabled={busy} onClick={() => void submitRental(rentalAttempt)}>{text.retry}</button>
      </div> : rentalReturnAttempt && unknown ? <div className={styles.review} role="alert"><h2>{text.rentalReturnReview}</h2>
        <p>{rentalReturnAttempt.displayName} · {rentalReturnAttempt.request.expectedAssignment.cardNumber}</p>
        <p><strong>{rentalReturnAttempt.request.rentalReturned ? text.rentalReturnConsequence : text.rentalReturnCorrectionConsequence}</strong></p>
        <p>{text.unreachable}</p>
        <button disabled={busy} onClick={() => void submitRentalReturn(rentalReturnAttempt)}>{text.retry}</button>
      </div> : rentalReuseAttempt && unknown ? <div className={styles.review} role="alert"><h2>{text.rentalReuseReview}</h2>
        <p>{text.rentalReuseSource}: {rentalReuseAttempt.sourceDisplayName} · {rentalReuseAttempt.request.source.assignment.cardNumber}</p>
        <p>{text.rentalReuseTarget}: <strong>{rentalReuseAttempt.displayName}</strong></p>
        <p><strong>{text.rentalReuseConsequence}</strong></p>
        <p>{text.unreachable}</p>
        <button disabled={busy} onClick={() => void submitRentalReuse(rentalReuseAttempt)}>{text.retry}</button>
      </div> : selected?.multipleActiveAssignments ? <p role="alert">{text.multipleCards}</p> : selected && <div className={styles.workspace}>
        <p>{text.rentalState}: <strong>{selected.activeAssignment?.isRental ? text.rental : text.notRental}</strong></p>
        <button type="button" className="secondary" disabled={disabled || !selected.activeAssignment} onClick={prepareRental}>
          {selected.activeAssignment?.isRental ? text.rentalUnmark : text.rentalMark}
        </button>
        {selected.activeAssignment?.isRental && <>
          <p>{text.rentalReturnState}: <strong>{selected.activeAssignment.rentalReturned ? text.rentalReturned : text.rentalOutstanding}</strong></p>
          <button type="button" className="secondary" disabled={disabled} onClick={prepareRentalReturn}>
            {selected.activeAssignment.rentalReturned ? text.rentalReturnCorrect : text.rentalReturnMark}
          </button>
        </>}
        {!selected.activeAssignment && <>
          <p>{text.rentalNeedsCard}</p>
          <form className={styles.workspace} noValidate onSubmit={prepareRentalReuse}>
            <label htmlFor="returned-rental-card">{text.rentalReuseCard}</label>
            <select id="returned-rental-card" value={rentalReuseSourceId} disabled={disabled}
              onChange={(event) => setRentalReuseSourceId(event.target.value)}>
              <option value="">{text.rentalReuseChoose}</option>
              {returnedRentalSources.map((entry) => <option key={entry.activeAssignment!.id} value={entry.activeAssignment!.id}>
                {entry.activeAssignment!.cardNumber} · {entry.displayName}
              </option>)}
            </select>
            {returnedRentalSources.length === 0 ? <p>{text.rentalReuseNone}</p> : <>
              <p>{text.rentalReuseHelp}</p>
              <button disabled={disabled || !rentalReuseSourceId}>{text.rentalReuseInspect}</button>
            </>}
          </form>
        </>}
        <form className={styles.workspace} noValidate onSubmit={prepareCard}>
        <p>{text.currentCard}: <strong>{selected.activeAssignment?.cardNumber ?? text.noCard}</strong></p>
        <div className={styles.cardFields}>
          <label>{text.newCard}<input type="text" inputMode="numeric" autoComplete="off" spellCheck={false}
            value={newCard} required disabled={disabled} onChange={(event) => setNewCard(event.target.value)} /></label>
          <button disabled={disabled || !newCard.trim()}>{text.cardInspect}</button>
        </div>
        <p>{text.cardHelp}</p>
        </form>
      </div>}
      {!selected && !cardAttempt && !rentalAttempt && !rentalReturnAttempt && !rentalReuseAttempt && <p>{text.chooseParticipant}</p>}
    </section>}
    {action === "TIME" && <section className={styles.workspace} aria-label={text.timeTitle}>
      <h2>{text.timeTitle}</h2>
      {timeAttempt ? <div className={styles.review} role="alert"><h2>{text.timeReview}</h2>
        <p>{timeAttempt.displayName}</p>
        <p>{text.previousTime}: {timeAttempt.request.expectedFixedStartTime === null ? text.noFixedTime : formatClockTime(timeAttempt.request.expectedFixedStartTime, timeAttempt.timeZone)}</p>
        <p>{text.newTime}: <strong>{formatClockTime(timeAttempt.request.fixedStartTime, timeAttempt.timeZone)}</strong></p>
        <p>{text.resultImpact}</p>{unknown && <p>{text.unreachable}</p>}
        <button disabled={busy} onClick={() => void submitTime(timeAttempt)}>{unknown ? text.retry : text.timeConfirm}</button>
        {!unknown && <button className="secondary" disabled={busy} onClick={() => {
          pending.current = undefined; sent.current = false; setTimeAttempt(undefined);
        }}>{text.cancel}</button>}
      </div> : selected && selectedClass?.startRule === "FIXED" && data ? <form className={styles.workspace} noValidate onSubmit={prepareTime}>
        <p>{text.previousTime}: {selected.fixedStartTime === null ? text.noFixedTime : formatClockTime(selected.fixedStartTime, data.timeZone)}</p>
        <div className={styles.timeFields}>
          <label>{text.startClock}<input type="text" inputMode="numeric" autoComplete="off" placeholder="18:30" value={startClock} required disabled={disabled} onChange={(event) => setStartClock(event.target.value)} /></label>
        </div>
        <p>{text.timeHelpOnly}</p><p>{text.resultImpact}</p>
        <button disabled={disabled}>{text.timeInspect}</button>
      </form> : <p>{selected ? text.timePunch : text.chooseParticipant}</p>}
    </section>}
    {action === "IDENTITY" && <section className={styles.workspace} aria-label={text.identityAction}>
      <h2>{text.identityAction}</h2>
      {identityAttempt && unknown ? <div className={styles.review} role="alert"><h2>{text.identityReview}</h2>
        <p>{text.givenName}: {identityAttempt.request.expectedIdentity.givenName} → <strong>{identityAttempt.request.identity.givenName}</strong></p>
        <p>{text.familyName}: {identityAttempt.request.expectedIdentity.familyName} → <strong>{identityAttempt.request.identity.familyName}</strong></p>
        <p>{text.organisation}: {identityAttempt.request.expectedIdentity.organisationName ?? text.none} → <strong>{identityAttempt.request.identity.organisationName ?? text.none}</strong></p>
        <p>{text.identityHelp}</p><p>{text.unreachable}</p>
        <button disabled={busy} onClick={() => void submitIdentity(identityAttempt)}>{text.retry}</button>
      </div> : <>
        {!identityMatches && <button className="secondary" disabled={disabled} onClick={() => void loadIdentity()}>{text.identityRefresh}</button>}
        {!selected ? <p>{text.chooseParticipant}</p> : !identityMatches ? <p>{text.identityLoadError}</p> : <form className={styles.workspace} noValidate onSubmit={prepareIdentity}>
          <div className={styles.identityFields}>
            <label>{text.givenName}<input autoComplete="off" value={givenName} required maxLength={160} disabled={disabled} onChange={(event) => setGivenName(event.target.value)} /></label>
            <label>{text.familyName}<input autoComplete="off" value={familyName} required maxLength={160} disabled={disabled} onChange={(event) => setFamilyName(event.target.value)} /></label>
            <label>{text.organisation}<input autoComplete="off" value={organisationName} list="administrator-clubs" disabled={disabled} onChange={(event) => setOrganisationName(event.target.value)} /></label>
          </div>
          <datalist id="administrator-clubs">{[...new Set(data?.entries.map((row) => row.organisationName).filter((name): name is string => name !== null))].sort().map((name) => <option key={name} value={name} />)}</datalist>
          <p>{text.identityHelp}</p><button disabled={disabled}>{text.identityInspect}</button>
        </form>}
      </>}
    </section>}
  </>;
}

/**
 * Ny deltagare i ett steg (PLAN.md steg 24): fyll i och tryck Lägg till (eller Enter). Formuläret står kvar för nästa
 * deltagare och raden under säger vem som lades till. Bara en möjlig dubblett kräver ett val, direkt i formuläret.
 */
export function RegistrationForm({ ws }: { ws: Workspace }) {
  const { action, busy, chooseAction, classId, confirmDistinctPerson, data, familyName, givenName, newCard, organisationName,
    prepareRegistration, raceId, registrationAttempt, registrationErrors, registrationForm, registrationSaved, selectRegistrationCandidate,
    sent, setClassId, setConfirmDistinctPerson, setFamilyName, setGivenName, setNewCard, setOrganisationName, setRegistrationAttempt,
    setRegistrationErrors, setRegistrationSaved, setStartClock, startClock, startTimeOptional, submitRegistration, target, targetFull,
    pending, unknown } = ws;
  if (action !== "REGISTRATION") return null;
  const id = `registration-${raceId}`;
  const locked = busy || !!registrationAttempt;
  const duplicates = registrationAttempt && !unknown && !sent.current ? registrationAttempt.candidates.candidates : [];
  const clear = (field: keyof typeof registrationErrors) => {
    if (registrationErrors[field]) setRegistrationErrors({ ...registrationErrors, [field]: undefined });
    if (registrationSaved) setRegistrationSaved("");
  };
  const clubs = [...new Set(data?.entries.map(row => row.organisationName).filter((name): name is string => name !== null))].sort();
  return <section className={styles.workspace} aria-labelledby={`${id}-title`}>
    <div className={styles.inlineFormHead}>
      <h2 id={`${id}-title`}>{text.registrationTitle}</h2>
      <Button variant="quiet" disabled={locked} onClick={() => chooseAction("INFO")}>{text.registrationClose}</Button>
    </div>
    {!data ? <p>{text.error}</p> : <form ref={registrationForm} className={styles.registrationForm} noValidate
      onSubmit={event => void prepareRegistration(event)}>
      <Field label={text.registrationClass} error={registrationErrors.classId}
        help={target ? text.classFacts(target.entryCount, target.maxEntries, target.startRule === "FIXED" ? text.fixed : text.punch) : undefined}>
        <select value={classId} disabled={locked} onChange={event => { setClassId(event.target.value); setStartClock(""); clear("classId"); }}>
          <option value="">{text.chooseClass}</option>
          {data.classes.filter(row => row.relayLegCount === undefined).map(row => <option key={row.id} value={row.id}>{row.name}</option>)}
        </select></Field>
      <div className={styles.identityFields}>
        <Field label={text.givenName} error={registrationErrors.givenName}><input name="givenName" value={givenName} maxLength={160}
          autoComplete="off" disabled={locked} onChange={event => { setGivenName(event.target.value); clear("givenName"); }} /></Field>
        <Field label={text.familyName} error={registrationErrors.familyName}><input name="familyName" value={familyName} maxLength={160}
          autoComplete="off" disabled={locked} onChange={event => { setFamilyName(event.target.value); clear("familyName"); }} /></Field>
        <Field label={text.organisation}><input value={organisationName} maxLength={200} autoComplete="off" list={`${id}-clubs`}
          disabled={locked} onChange={event => setOrganisationName(event.target.value)} /></Field>
        <Field label={text.registrationCard} error={registrationErrors.card}><input value={newCard} inputMode="numeric" maxLength={32}
          autoComplete="off" disabled={locked} onChange={event => { setNewCard(event.target.value); clear("card"); }} /></Field>
      </div>
      <datalist id={`${id}-clubs`}>{clubs.map(name => <option key={name} value={name} />)}</datalist>
      {target?.startRule === "FIXED" && (target.startDrawn
        ? <Notice tone="info">{text.registrationDrawnTimeHelp}</Notice>
        : <Field label={text.startClock} error={registrationErrors.startClock}
          help={startTimeOptional ? text.registrationLaterTimeHelp : text.timeHelp}><input value={startClock} inputMode="numeric"
          placeholder="18:30" autoComplete="off" disabled={locked} onChange={event => { setStartClock(event.target.value); clear("startClock"); }} /></Field>)}
      {targetFull && <Notice tone="attention">{text.classFull}</Notice>}
      {duplicates.length > 0 && registrationAttempt && <div className={styles.review} role="alert">
        <h3>{text.registrationReview}</h3>
        <ul className={styles.duplicateList}>{duplicates.map(row => <li key={row.entryId}>
          <span><strong>{row.givenName} {row.familyName}</strong> · {row.className} · {row.organisationName ?? text.none}
            {" · "}{row.reasons.map(reason => text.registrationReasons[reason]).join(" · ")}</span>
          <Button variant="quiet" disabled={busy} onClick={() => selectRegistrationCandidate(row.entryId)}>{text.registrationSelectExisting}</Button>
        </li>)}</ul>
        <label className={styles.confirmPerson}><input type="checkbox" checked={confirmDistinctPerson} disabled={busy}
          onChange={event => setConfirmDistinctPerson(event.target.checked)} />{text.registrationDistinctPerson}</label>
        <div className={styles.actions}>
          <Button disabled={busy || !confirmDistinctPerson} onClick={() => void submitRegistration(registrationAttempt)}>{text.registrationConfirm}</Button>
          <Button variant="secondary" disabled={busy} onClick={() => { pending.current = undefined; sent.current = false;
            setRegistrationAttempt(undefined); }}>{text.cancel}</Button>
        </div>
      </div>}
      {registrationAttempt && unknown && <Notice tone="attention" role="alert"><p>{text.unreachable}</p>
        <div><Button disabled={busy} onClick={() => void submitRegistration(registrationAttempt)}>{text.retry}</Button></div></Notice>}
      {!registrationAttempt && <div className={styles.actions}>
        <Button type="submit" disabled={busy}>{text.registrationInspect}</Button>
        <span className={styles.muted}>{text.registrationHelp}</span>
      </div>}
      {registrationSaved && <Notice tone="ok" role="status">{registrationSaved}</Notice>}
    </form>}
  </section>;
}
