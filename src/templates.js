const TEMPLATE_PATHS = [
  "./src/procedure-templates/ion-thruster-tvac-hotfire/template.json",
  "./src/procedure-templates/optical-payload-tvac/template.json",
  "./src/procedure-templates/rf-hat-payload-facility/template.json"
];

export const PROCEDURE_TEMPLATES = [];

export async function loadProcedureTemplates() {
  const templates = await Promise.all(
    TEMPLATE_PATHS.map(async (path) => {
      const response = await fetch(path);
      if (!response.ok) {
        throw new Error(`Unable to load procedure template: ${path}`);
      }
      const template = await response.json();
      const packageBase = path.slice(0, path.lastIndexOf("/") + 1);
      template.steps = template.steps.map((step) => ({
        ...step,
        images: (step.images || []).map((image) => ({
          ...image,
          src: `${packageBase}${image.src.replace(/^\.\//, "")}`
        }))
      }));
      return template;
    })
  );

  PROCEDURE_TEMPLATES.splice(0, PROCEDURE_TEMPLATES.length, ...templates);
  return PROCEDURE_TEMPLATES;
}

export function getTemplate(templateId) {
  return PROCEDURE_TEMPLATES.find((template) => template.id === templateId) || null;
}
