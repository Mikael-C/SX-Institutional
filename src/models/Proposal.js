const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const Proposal = sequelize.define('Proposal', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: false
    },
    data: {
      type: DataTypes.JSONB,
      allowNull: true,
      defaultValue: {}
    },
    status: {
      type: DataTypes.ENUM('Pending', 'Approved', 'Executed', 'Rejected'),
      defaultValue: 'Pending'
    },
    approvals: {
      type: DataTypes.JSONB,
      allowNull: false,
      defaultValue: []
    },
    createdBy: {
      type: DataTypes.STRING,
      allowNull: false
    },
    executedAt: {
      type: DataTypes.DATE,
      allowNull: true
    }
  }, {
    tableName: 'proposals',
    indexes: [
      { fields: ['status'] },
      { fields: ['createdBy'] }
    ]
  });

  return Proposal;
};
