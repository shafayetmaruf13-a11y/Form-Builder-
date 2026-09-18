import type { FormElement } from "@formcraft/schema";

import { ElementFrame } from "./element-frame";
import {
  DividerView,
  ImageView,
  ShapeView,
  TextView,
} from "./elements/static-elements";
import {
  CheckboxGroupView,
  CheckboxView,
  DateView,
  FileUploadView,
  NumberView,
  RadioGroupView,
  SelectView,
  SignatureView,
  TextInputView,
  TextareaView,
} from "./elements/input-elements";

/**
 * Dispatches an element to its view.
 *
 * The switch is exhaustive over the schema's discriminated union, and the
 * `never` in the default branch means adding an element type to the schema
 * without adding a view here is a *type error*, not a blank space on a page.
 */
export function ElementView({
  element,
  imageSrc,
  offset,
}: {
  element: FormElement;
  /** Resolves an image element's objectKey to a URL. Slice 3 supplies it. */
  imageSrc?: (objectKey: string) => string;
  /** Live drag displacement in page units; builder only. */
  offset?: { dx: number; dy: number } | null;
}) {
  return (
    <ElementFrame element={element} offset={offset}>
      {renderBody(element, imageSrc)}
    </ElementFrame>
  );
}

function renderBody(
  element: FormElement,
  imageSrc?: (objectKey: string) => string,
) {
  switch (element.type) {
    case "text":
      return <TextView element={element} />;
    case "image":
      return (
        <ImageView
          element={element}
          src={
            element.objectKey ? (imageSrc?.(element.objectKey) ?? null) : null
          }
        />
      );
    case "shape":
      return <ShapeView element={element} />;
    case "divider":
      return <DividerView element={element} />;
    case "textInput":
      return <TextInputView element={element} />;
    case "textarea":
      return <TextareaView element={element} />;
    case "checkbox":
      return <CheckboxView element={element} />;
    case "checkboxGroup":
      return <CheckboxGroupView element={element} />;
    case "radioGroup":
      return <RadioGroupView element={element} />;
    case "select":
      return <SelectView element={element} />;
    case "date":
      return <DateView element={element} />;
    case "number":
      return <NumberView element={element} />;
    case "signature":
      return <SignatureView element={element} />;
    case "fileUpload":
      return <FileUploadView element={element} />;
    default: {
      const exhaustive: never = element;
      return exhaustive;
    }
  }
}
