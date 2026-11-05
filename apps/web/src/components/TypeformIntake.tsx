"use client";
import { Widget } from "@typeform/embed-react";
import { TF_HIDDEN_UID } from "@travel/core";

/** The Typeform intake, embedded inline. Calls onSubmit with the response id when the traveler finishes. */
export default function TypeformIntake({ formId, uid, onSubmit }: { formId: string; uid: string; onSubmit: (responseId: string) => void }) {
  return (
    <div className="tf-wrap">
      <Widget
        id={formId}
        className="tf-widget"
        hidden={{ [TF_HIDDEN_UID]: uid }}
        inlineOnMobile
        opacity={0}
        hideFooter={false}
        onSubmit={({ responseId }) => onSubmit(responseId)}
      />
    </div>
  );
}
