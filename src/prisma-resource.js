import { BaseRecord } from 'adminjs';
import { Resource, convertParam } from '@adminjs/prisma';

// The stock @adminjs/prisma adapter cannot open eight of our tables. Both causes
// trace back to one line in its prepareProperties(), which drops every field with
// `isReadOnly` — and Prisma sets isReadOnly on any scalar that backs a relation,
// i.e. on every foreign key.
//
//   1. A primary key that is ALSO a foreign key gets thrown away, leaving the
//      resource with no id at all. That's every one-to-one extension table:
//      coaches.user_id, profile_achievement_layouts.user_id, pro_prices.currency.
//      Symptom: `Resource "coaches" does not have an id property`.
//
//   2. Composite-key join tables (@@id([a, b])) have no single `isId` field for
//      the adapter to find, AND both halves of the key are foreign keys, so they
//      get dropped too. Symptom: `Cannot read properties of undefined` in
//      buildSortBy. That's connections, chat_members, coach_package_plans,
//      coach_package_prices and feed_tags.
//
// This subclass puts primary-key columns back, and gives composite-key tables a
// synthetic `id` ("<a>|<b>") that every lookup translates back into Prisma's
// compound-key where clause.

const SEP = '|';

export class PrismaResource extends Resource {
  /** The real primary key: the @@id list if composite, else the @id field. */
  primaryKeyFields() {
    const composite = this.model.primaryKey?.fields;
    if (composite?.length) return composite;
    return this.model.fields.filter((f) => f.isId).map((f) => f.name);
  }

  get isComposite() {
    return (this.model.primaryKey?.fields?.length ?? 0) > 1;
  }

  /** Prisma names an unnamed compound key after its columns: `feed_id_tag_id`. */
  compositeWhere(id) {
    const fields = this.primaryKeyFields();
    const values = String(id).split(SEP);
    const key = {};

    fields.forEach((field, i) => {
      key[field] = convertParam(this.property(field), this.model.fields, values[i]);
    });

    return { [fields.join('_')]: key };
  }

  // Called from the parent constructor, so this.model and this.enums already exist.
  prepareProperties() {
    const properties = super.prepareProperties();

    // The Property class isn't exported from the package, so borrow it from an
    // instance the parent just built.
    const Property = Object.values(properties)[0]?.constructor;
    if (!Property) return properties;

    const restored = {};
    let position = 0;

    if (this.isComposite) {
      // A virtual id. prepareReturnValues() below fills it in on every row.
      restored.id = new Property(
        {
          name: 'id',
          kind: 'scalar',
          type: 'String',
          isId: true,
          isRequired: true,
          isList: false,
          isUnique: true,
          isReadOnly: false,
          hasDefaultValue: false,
          isGenerated: false,
          isUpdatedAt: false,
        },
        position++,
        this.enums,
      );
    }

    // Put back any primary-key column the parent dropped for being a foreign key.
    for (const name of this.primaryKeyFields()) {
      if (properties[name]) continue;
      const field = this.model.fields.find((f) => f.name === name);
      if (field) restored[name] = new Property(field, position++, this.enums);
    }

    return { ...restored, ...properties };
  }

  prepareReturnValues(record) {
    const values = super.prepareReturnValues(record);

    if (this.isComposite) {
      values.id = this.primaryKeyFields().map((f) => String(record[f])).join(SEP);
    }

    return values;
  }

  buildSortBy(sort = {}) {
    if (!this.isComposite) return super.buildSortBy(sort);

    // The synthetic id is not a column — Prisma would reject `orderBy: { id }`.
    const { direction = 'desc' } = sort;
    const path = !sort.sortBy || sort.sortBy === 'id' ? this.primaryKeyFields()[0] : sort.sortBy;

    return { [path]: direction };
  }

  async findOne(id) {
    if (!this.isComposite) return super.findOne(id);

    const result = await this.manager.findUnique({ where: this.compositeWhere(id) });
    if (!result) return null;

    return new BaseRecord(this.prepareReturnValues(result), this);
  }

  async findMany(ids) {
    if (!this.isComposite) return super.findMany(ids);

    const fields = this.primaryKeyFields();
    const results = await this.manager.findMany({
      where: {
        OR: ids.map((id) => {
          const values = String(id).split(SEP);
          return Object.fromEntries(
            fields.map((field, i) => [
              field,
              convertParam(this.property(field), this.model.fields, values[i]),
            ]),
          );
        }),
      },
    });

    return results.map((result) => new BaseRecord(this.prepareReturnValues(result), this));
  }

  async update(pk, params = {}) {
    if (!this.isComposite) return super.update(pk, params);

    const result = await this.manager.update({
      where: this.compositeWhere(pk),
      data: this.prepareParams(params),
    });

    return this.prepareReturnValues(result);
  }

  async delete(id) {
    if (!this.isComposite) return super.delete(id);

    await this.manager.delete({ where: this.compositeWhere(id) });
  }
}
