"use client";
import { Widget } from "@typeform/embed-react";
import { TF_BROWSE_ENDING, TF_HIDDEN_UID } from "@travel/core";
import { useRouter } from "next/navigation";

/**
 * The Typeform intake, embedded inline. Calls onSubmit with the response id when the traveler
 * finishes. Picking "not sure yet" ends the form on a screen that sends them to Browse.
 */
export default function TypeformIntake({ formId, uid, onSubmit }: { formId: string; uid: string; onSubmit: (responseId: string) => void }) {
  const router = useRouter();
  return (
    <div className="tf-wrap">
      <Widget
        id={formId}
        className="tf-widget"
        hidden={{ [TF_HIDDEN_UID]: uid }}
        inlineOnMobile
        opacity={0}
        hideFooter={false}
        redirectTarget="_top"
        onSubmit={({ responseId }) => onSubmit(responseId)}
        onEndingButtonClick={({ ref }) => {
          if (ref === TF_BROWSE_ENDING) router.push("/");
        }}
      />
    </div>
  );
}
