const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const Dispute = sequelize.define('Dispute', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    asset: {
      type: DataTypes.STRING,
      allowNull: false
    },
    feedId: {
      type: DataTypes.STRING,
      allowNull: false
    },
    deviation: {
      type: DataTypes.DECIMAL(36, 18),
      allowNull: false
    },
    chain: {
      type: DataTypes.STRING,
      allowNull: false
    },
    resolvedAt: {
      type: DataTypes.DATE,
      allowNull: true
    },
    status: {
      type: DataTypes.ENUM('Active', 'Resolved', 'Rejected'),
      defaultValue: 'Active'
    }
  }, {
    tableName: 'disputes',
    indexes: [
      { fields: ['asset'] },
      { fields: ['status'] },
      { fields: ['chain'] }
    ]
  });

  return Dispute;
};
