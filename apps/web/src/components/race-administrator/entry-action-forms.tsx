"use client";

import styles from "../race-administrator-workspace.module.css";
import { raceAdministratorSv as text } from "../../i18n/race-administrator-sv";
import { formatClockTime, parseRaceClock } from "../../lib/clock-time";
import { TargetClassStartTimes } from "../target-class-start-times";
import type { EntryPaymentStatus } from "@o-tid/contracts";
import type { Workspace } from "./workspace-state";

/** Deltagaråtgärder: byt klass, bricka och hyrbricka, betalning, starttid och identitet. */
export function EntryActionForms({ ws }: { ws: Workspace }) {
  const { action, busy, cardAttempt, classId, data, disabled, familyName, givenName, identityAttempt,
    identityMatches, loadIdentity, loadTransferStartSlots, newCard, organisationName, paymentStatus,
    paymentStatusAttempt, pending, prepareCard, prepareIdentity, preparePaymentStatus, prepareRental,
    prepareRentalReturn, prepareRentalReuse, prepareTime, prepareTransfer, rentalAttempt, rentalReturnAttempt,
    rentalReuseAttempt, rentalReuseSourceId, returnedRentalSources, selected, selectedClass,
    selectedTransferStartSlot, sent, setClassId, setFamilyName, setGivenName, setMessage, setNewCard, setOrganisationName, setPaymentStatus, setRentalReuseSourceId, setSelectedTransferStartSlot,
    setStartClock, setTimeAttempt, setTransferAttempt, startClock, submitCard, submitIdentity, submitPaymentStatus, submitRental, submitRentalReturn,
    submitRentalReuse, submitTime, submitTransfer, target, targetFull, timeAttempt, transferAttempt,
    transferStartSlots, unknown } = ws;
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
    </div> : selected ? <form className={styles.workspace} onSubmit={prepareTransfer}>
      <p>{text.previousTime}: {selected.fixedStartTime && data ? formatClockTime(selected.fixedStartTime, data.timeZone) : text.noFixedTime}</p>
      <label>{text.targetClass}<select value={classId} disabled={disabled} required onChange={(event) => {
        setClassId(event.target.value); setStartClock(""); setMessage("");
        void loadTransferStartSlots(event.target.value);
      }}>
        <option value="">{text.chooseClass}</option>{data?.classes.filter((row) => row.id !== selected.classId).map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
      </select></label>
      {target && <p>{text.startRule}: <strong>{target.startRule === "FIXED" ? text.fixed : text.punch}</strong></p>}
      {target && <p>{text.capacityCount}: {target.entryCount} / {target.maxEntries ?? text.unlimited} {targetFull && <strong>— {text.classFull}</strong>}</p>}
      {target?.startRule === "FIXED" && <>
        {transferStartSlots?.targetClassId === target.id && transferStartSlots.plan.status === "AVAILABLE" && <label>{text.transferSlotSelect}
          <select value={selectedTransferStartSlot} disabled={disabled} onChange={(event) => setSelectedTransferStartSlot(event.target.value)}>
            <option value="">{text.transferSlotManual}</option>
            {transferStartSlots.plan.slots.map(slot => <option key={slot.fixedStartTime} value={slot.fixedStartTime}>{formatClockTime(slot.fixedStartTime, data?.timeZone ?? "Europe/Stockholm")}</option>)}
          </select>
        </label>}
        {transferStartSlots?.targetClassId === target.id && transferStartSlots.plan.status === "UNAVAILABLE" && <p className={styles.warning}>{text.transferSlotUnavailable}</p>}
        {data && <TargetClassStartTimes key={`${target.id}:${data.snapshotVersion}`} entries={data.entries} classId={target.id}
          timeZone={data.timeZone} proposedTime={parseRaceClock(data.raceDate, startClock, data.timeZone)} />}
        {!selectedTransferStartSlot && <div className={styles.timeFields}>
          <label>{text.startClock}<input type="text" inputMode="numeric" autoComplete="off" placeholder="18:30" value={startClock} required disabled={disabled}
            onChange={(event) => setStartClock(event.target.value)} /></label>
        </div>}
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
          <form className={styles.workspace} onSubmit={prepareRentalReuse}>
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
        <form className={styles.workspace} onSubmit={prepareCard}>
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
    {action === "PAYMENT" && <section className={styles.workspace} aria-label={text.paymentStatusAction}>
      <h2>{text.paymentStatusAction}</h2>
      {paymentStatusAttempt && unknown ? <div className={styles.review} role="alert"><h2>{text.paymentStatusReview}</h2>
        <p>{paymentStatusAttempt.displayName}</p>
        <p>{text.paymentStatusCurrent}: {text.paymentStatuses[paymentStatusAttempt.request.expectedPaymentStatus]} → <strong>{text.paymentStatuses[paymentStatusAttempt.request.paymentStatus]}</strong></p>
        <p><strong>{text.paymentStatusConsequence}</strong></p>
        <p>{text.unreachable}</p>
        <button disabled={busy} onClick={() => void submitPaymentStatus(paymentStatusAttempt)}>{text.retry}</button>
      </div> : selected ? <form className={styles.workspace} onSubmit={preparePaymentStatus}>
        <p>{text.paymentStatusCurrent}: <strong>{text.paymentStatuses[selected.paymentStatus]}</strong></p>
        <label htmlFor="entry-payment-status">{text.paymentStatusNew}</label><select id="entry-payment-status" value={paymentStatus} disabled={disabled}
          onChange={(event) => setPaymentStatus(event.target.value as EntryPaymentStatus)}>
          <option value="UNMARKED">{text.paymentStatuses.UNMARKED}</option>
          <option value="UNPAID">{text.paymentStatuses.UNPAID}</option>
          <option value="PAID">{text.paymentStatuses.PAID}</option>
          <option value="WAIVED">{text.paymentStatuses.WAIVED}</option>
        </select>
        <p>{text.paymentStatusHelp}</p>
        <button disabled={disabled || paymentStatus === selected.paymentStatus}>{text.paymentStatusInspect}</button>
      </form> : <p>{text.chooseParticipant}</p>}
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
      </div> : selected && selectedClass?.startRule === "FIXED" && data ? <form className={styles.workspace} onSubmit={prepareTime}>
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
        {!selected ? <p>{text.chooseParticipant}</p> : !identityMatches ? <p>{text.identityLoadError}</p> : <form className={styles.workspace} onSubmit={prepareIdentity}>
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

/** Ny deltagare med dubblettkontroll. */
export function RegistrationForm({ ws }: { ws: Workspace }) {
  const { action, busy, classId, confirmDistinctPerson, data, disabled, familyName, givenName,
    loadRegistrationStartSlots, newCard, organisationName, pending, prepareRegistration, registrationAttempt,
    registrationStartSlots, selectRegistrationCandidate, selectedRegistrationStartSlot, sent, setClassId,
    setConfirmDistinctPerson, setFamilyName, setGivenName, setNewCard, setOrganisationName, setRegistrationAttempt,
    setSelectedRegistrationStartSlot, setStartClock, startClock, submitRegistration, target, targetFull, unknown } = ws;
  return <>
    {action === "REGISTRATION" && <section className={styles.workspace} aria-label={text.registrationTitle}>
      <h2>{text.registrationTitle}</h2>
      {registrationAttempt ? <div className={styles.review} role="alert"><h2>{text.registrationReview}</h2>
        <p>{registrationAttempt.request.givenName} {registrationAttempt.request.familyName} · {registrationAttempt.className}</p>
        <p>{text.organisation}: {registrationAttempt.request.organisationName ?? text.none} · {text.registrationCard}: {registrationAttempt.request.cardNumber ?? text.noCard}</p>
        <p>{text.startRule}: {registrationAttempt.request.expectedStartRule === "FIXED" ? text.fixed : text.punch}</p>
        <p>{text.newTime}: {registrationAttempt.request.fixedStartTime === null ? text.noFixedTime : formatClockTime(registrationAttempt.request.fixedStartTime, registrationAttempt.timeZone)}</p>
        <p>{text.registrationHelp}</p>{unknown && <p>{text.unreachable}</p>}
        {!unknown && !sent.current && <div className={styles.workspace}>
          <p>{text.registrationMatches}: {registrationAttempt.candidates.totalMatches} · {text.shown}: {registrationAttempt.candidates.candidates.length}</p>
          {registrationAttempt.candidates.candidates.length > 0 && <ul className={styles.duplicateList}>{registrationAttempt.candidates.candidates.map((row) => <li key={row.entryId}>
            <p><strong>{row.givenName} {row.familyName}</strong> · {row.className} · {row.organisationName ?? text.none}</p>
            <p>{row.reasons.map((reason) => text.registrationReasons[reason]).join(" · ")}</p>
            <button type="button" className="secondary" disabled={busy} onClick={() => selectRegistrationCandidate(row.entryId)}>{text.registrationSelectExisting}: {row.givenName} {row.familyName}</button>
          </li>)}</ul>}
          {registrationAttempt.candidates.candidates.some((row) => row.reasons.includes("CARD_ALREADY_ASSIGNED")) ? <p className={styles.warning}>{text.registrationCardConflict}</p> :
            registrationAttempt.candidates.candidates.some((row) => row.reasons.includes("SAME_NAME")) && <label className={styles.confirmPerson}>
              <input type="checkbox" checked={confirmDistinctPerson} disabled={busy} onChange={(event) => setConfirmDistinctPerson(event.target.checked)} />{text.registrationDistinctPerson}
            </label>}
        </div>}
        <button disabled={busy || (!sent.current && (registrationAttempt.candidates.candidates.some((row) => row.reasons.includes("CARD_ALREADY_ASSIGNED")) ||
          (registrationAttempt.candidates.candidates.some((row) => row.reasons.includes("SAME_NAME")) && !confirmDistinctPerson)))} onClick={() => void submitRegistration(registrationAttempt)}>{unknown ? text.retry : text.registrationConfirm}</button>
        {!unknown && <button className="secondary" disabled={busy} onClick={() => { pending.current = undefined; sent.current = false; setRegistrationAttempt(undefined); }}>{text.cancel}</button>}
      </div> : data ? <form className={styles.workspace} onSubmit={(event) => void prepareRegistration(event)}>
        <label>{text.registrationClass}<select value={classId} required disabled={disabled} onChange={(event) => {
          const value = event.target.value; setClassId(value); setStartClock(""); void loadRegistrationStartSlots(value);
        }}><option value="">{text.chooseClass}</option>{data.classes.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
        {target && <p>{text.capacityCount}: {target.entryCount} / {target.maxEntries ?? text.unlimited} {targetFull && <strong>— {text.classFull}</strong>}</p>}
        <div className={styles.identityFields}>
          <label>{text.givenName}<input value={givenName} required maxLength={160} autoComplete="off" disabled={disabled} onChange={(event) => setGivenName(event.target.value)} /></label>
          <label>{text.familyName}<input value={familyName} required maxLength={160} autoComplete="off" disabled={disabled} onChange={(event) => setFamilyName(event.target.value)} /></label>
          <label>{text.organisation}<input value={organisationName} maxLength={200} autoComplete="off" disabled={disabled} onChange={(event) => setOrganisationName(event.target.value)} /></label>
        </div>
        <label>{text.registrationCard}<input value={newCard} inputMode="numeric" maxLength={32} autoComplete="off" disabled={disabled} onChange={(event) => setNewCard(event.target.value)} /></label>
        {target && <p>{text.startRule}: {target.startRule === "FIXED" ? text.fixed : text.punch}</p>}
        {target?.startRule === "FIXED" && <>
          {registrationStartSlots?.targetClassId === target.id && registrationStartSlots.plan.status === "AVAILABLE" && <label>{text.registrationLottedSlot}
            <select value={selectedRegistrationStartSlot} disabled={disabled} onChange={(event) => setSelectedRegistrationStartSlot(event.target.value)}>
              <option value="">{text.registrationManualTime}</option>
              {registrationStartSlots.plan.slots.map(slot => <option key={slot.fixedStartTime} value={slot.fixedStartTime}>{formatClockTime(slot.fixedStartTime, data.timeZone)}</option>)}
            </select>
          </label>}
          {registrationStartSlots?.targetClassId === target.id && registrationStartSlots.plan.status === "UNAVAILABLE" && <p className={styles.warning}>{text.registrationSlotUnavailable}</p>}
          {!selectedRegistrationStartSlot && <div className={styles.timeFields}>
            <label>{text.startClock}<input value={startClock} required inputMode="numeric" placeholder="18:30" autoComplete="off" disabled={disabled} onChange={(event) => setStartClock(event.target.value)} /></label>
          </div>}
        </>}
        <p>{text.registrationHelp}</p><button disabled={disabled || !target || targetFull}>{text.registrationInspect}</button>
      </form> : <p>{text.error}</p>}
    </section>}
  </>;
}
